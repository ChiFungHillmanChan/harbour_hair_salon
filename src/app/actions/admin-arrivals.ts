'use server';

import { revalidatePath } from 'next/cache';
import { appendAuditEvent } from '@/app/lib/audit';
import { verifySession } from '@/app/lib/session';
import { isArrivalWindowOpen, isLateCancelRestorable } from '@/app/lib/late-arrival';
import { describeAdminMoveClashes, type MoveClash } from '@/app/services/admin-move-clashes';
import { runSerializableWithRetry } from '@/app/services/booking-service';
import { BookingError, bookingErrorText, describeBookingError } from '@/app/services/booking-errors';
import { findApplicableConsultationCredit } from '@/app/services/consultation-credit';
import { recordedPrice } from '@/app/services/pricing/recorded-price';
import { invalidateStylistIcalFeed } from '@/app/services/stylist-ical-cache';
import { describeFault } from '@/app/lib/fault';
import { getActionLocale } from '@/i18n/request';
import { revalidateAllLocales } from '@/i18n/revalidate';

// Late arrivals (docs/superpowers/specs/2026-10-16-late-arrival-auto-cancel-design.md
// §4.1, §4.3): staff record that the customer is here, and undo the rule's
// cancellation within 24 hours.

type Result = { success: true } | { success: false; error: string };

/** Staff record (or clear) that the customer is here: the late-arrival rule never cancels an arrived booking. */
export async function markArrived(appointmentId: string, arrived: boolean): Promise<Result> {
  const locale = await getActionLocale();
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { success: false, error: bookingErrorText(locale, 'NOT_AUTHORISED') };
  try {
    const now = new Date();
    await runSerializableWithRetry(async (tx) => {
      const current = await tx.appointment.findUnique({
        where: { id: appointmentId },
        select: { status: true, date: true, arrivedAt: true, lateCancelledAt: true, durationAtBooking: true, service: { select: { duration: true } } },
      });
      if (!current) throw new BookingError('APPOINTMENT_NOT_FOUND');
      // The rule cancelled it a moment ago: the way back is Restore.
      if (current.status === 'CANCELLED' && current.lateCancelledAt) throw new BookingError('LATE_CANCELLED_USE_RESTORE');
      if (current.status !== 'CONFIRMED') throw new BookingError('ONLY_CONFIRMED_ARRIVAL');
      if (!isArrivalWindowOpen(current.date, current.durationAtBooking ?? current.service.duration, now)) throw new BookingError('ARRIVAL_WINDOW_CLOSED');
      // Already as asked: the first arrival time stands.
      if (Boolean(current.arrivedAt) === arrived) return;
      // Conditional: the late-arrival rule cancelling it meanwhile wins (STALE).
      const result = await tx.appointment.updateMany({
        where: { id: appointmentId, status: 'CONFIRMED', arrivedAt: current.arrivedAt },
        data: { arrivedAt: arrived ? now : null },
      });
      if (result.count !== 1) throw new BookingError('STALE');
      await appendAuditEvent({
        actorUserId: session.userId, action: arrived ? 'APPOINTMENT.ARRIVED' : 'APPOINTMENT.ARRIVAL_CLEARED',
        targetType: 'Appointment', targetId: appointmentId,
      }, tx);
    });
  } catch (error) {
    if (!(error instanceof BookingError)) console.error('Recording an arrival failed:', { appointmentId, ...describeFault(error) });
    return { success: false, error: describeBookingError(error, locale, 'ADMIN_UPDATE_FAILED') };
  }
  revalidateAllLocales(revalidatePath, '/admin');
  return { success: true };
}

/**
 * Undo the late-arrival rule within 24 hours (usually: the customer is in the
 * chair and nobody tapped Arrived). The kept deposit counts towards the bill
 * again; the late-cancel email, if still waiting, is no longer current and is
 * dropped. A clash (Fresha may have resold the time) is reported unless forced.
 * A consultation credit the booking records is checked again: while the
 * booking was cancelled the credit was free, and another booking may have
 * taken it (consultation-credit.ts).
 */
export async function restoreLateCancellation(
  appointmentId: string,
  options: { force?: boolean } = {},
): Promise<Result | { success: false; clashes: MoveClash[] }> {
  const locale = await getActionLocale();
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { success: false, error: bookingErrorText(locale, 'NOT_AUTHORISED') };
  try {
    const now = new Date();
    const outcome = await runSerializableWithRetry(async (tx) => {
      const current = await tx.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          status: true, date: true, lateCancelledAt: true, stylistId: true, userId: true, durationAtBooking: true,
          priceAtBooking: true, quoteJson: true, consultationCreditFromId: true, consultationCreditPence: true,
          service: { select: { duration: true } }, paymentAttempt: { select: { id: true, status: true, amountPence: true } },
        },
      });
      if (!current) throw new BookingError('APPOINTMENT_NOT_FOUND');
      if (current.status !== 'CANCELLED') {
        // Already restored (a double tap, or a colleague): done. Anything else
        // changed under the panel: refresh, never "create a new booking".
        if (current.status === 'CONFIRMED' && !current.lateCancelledAt) return { kind: 'already' as const };
        throw new BookingError('STALE');
      }
      // A refunded (or otherwise not kept) deposit cannot be undone, so neither can its booking.
      const deposit = current.paymentAttempt;
      if (!isLateCancelRestorable(current.lateCancelledAt, now) || (deposit && deposit.status !== 'KEPT')) {
        throw new BookingError('LATE_CANCEL_NOT_RESTORABLE');
      }
      const clashes = await describeAdminMoveClashes(tx, {
        appointmentId, stylistId: current.stylistId, start: current.date,
        durationMin: current.durationAtBooking ?? current.service.duration, userId: current.userId, requiresPatchTest: false,
      });
      if (clashes.length > 0 && !options.force) return { kind: 'clashes' as const, clashes };
      // A CANCELLED booking holds no consultation credit, so another booking
      // may have taken this one's meanwhile. Looked up again in this
      // transaction, as editAppointmentByAdmin does: the same consultation
      // while it still qualifies, else another unused one, else none — capped
      // at what the deposit, CAPTURED again below, leaves of the price.
      // Audited flat (audit metadata holds scalars only): what became of it, and the amount the booking now records.
      let credit: {
        columns: { consultationCreditFromId: string | null; consultationCreditPence: number | null };
        audit: { consultationCredit: 'kept' | 'reassigned' | 'cleared'; consultationCreditPence: number };
      } | null = null;
      if (current.consultationCreditFromId !== null || current.consultationCreditPence !== null) {
        const price = recordedPrice(current);
        const found = await findApplicableConsultationCredit(tx, {
          userId: current.userId,
          at: current.date,
          treatmentPricePence: price.known ? price.amountPence : null,
          capturedDepositPence: deposit ? deposit.amountPence : 0,
          excludeAppointmentId: appointmentId,
          preferAppointmentId: current.consultationCreditFromId ?? undefined,
        });
        credit = found
          ? {
              columns: { consultationCreditFromId: found.fromAppointmentId, consultationCreditPence: found.amountPence },
              audit: {
                consultationCredit: found.fromAppointmentId === current.consultationCreditFromId ? 'kept' : 'reassigned',
                consultationCreditPence: found.amountPence,
              },
            }
          : { columns: { consultationCreditFromId: null, consultationCreditPence: null }, audit: { consultationCredit: 'cleared', consultationCreditPence: 0 } };
      }
      // Booking and deposit move together, each behind a conditional write: a
      // CONFIRMED booking with a KEPT deposit, or a CANCELLED one with a
      // CAPTURED deposit, never commits.
      const restored = await tx.appointment.updateMany({
        where: { id: appointmentId, status: 'CANCELLED', lateCancelledAt: current.lateCancelledAt },
        data: { status: 'CONFIRMED', lateCancelledAt: null, arrivedAt: now, notificationVersion: { increment: 1 }, ...(credit?.columns ?? {}) },
      });
      if (restored.count !== 1) throw new BookingError('STALE');
      if (deposit) {
        const back = await tx.paymentAttempt.updateMany({ where: { id: deposit.id, status: 'KEPT' }, data: { status: 'CAPTURED' } });
        if (back.count !== 1) throw new BookingError('STALE');
      }
      await appendAuditEvent({
        actorUserId: session.userId, action: 'APPOINTMENT.LATE_CANCEL_RESTORED', targetType: 'Appointment', targetId: appointmentId,
        metadata: {
          forced: Boolean(options.force && clashes.length),
          ...(deposit ? { deposit: 'CAPTURED' } : {}),
          ...(credit ? credit.audit : {}),
        },
      }, tx);
      return { kind: 'restored' as const };
    });
    if (outcome.kind === 'clashes') return { success: false, clashes: outcome.clashes };
    if (outcome.kind === 'already') {
      revalidateAllLocales(revalidatePath, '/admin');
      return { success: true };
    }
  } catch (error) {
    if (!(error instanceof BookingError)) console.error('Restoring a late cancellation failed:', { appointmentId, ...describeFault(error) });
    return { success: false, error: describeBookingError(error, locale, 'ADMIN_UPDATE_FAILED') };
  }
  invalidateStylistIcalFeed();
  revalidateAllLocales(revalidatePath, '/admin');
  revalidateAllLocales(revalidatePath, '/appointments');
  return { success: true };
}
