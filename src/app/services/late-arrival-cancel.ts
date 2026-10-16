import 'server-only';
import prisma from '@/app/lib/prisma';
import { appendAuditEvent } from '@/app/lib/audit';
import { describeFault } from '@/app/lib/fault';
import { isLateCancelCandidate, lateCancelWindow } from '@/app/lib/late-arrival';
import { LATE_CANCEL_EMAIL_DELAY_MINUTES } from '@/app/lib/booking-constants';
import { runSerializableWithRetry } from './booking-service';
import { BookingError } from './booking-errors';
import { linkedDepositSelect, planDepositForClosing, settleDepositAfterCommit } from './deposit-lifecycle';
import { enqueueAppointmentNotification } from './notification-outbox-service';
import { readSalonPhoneForLapseNotice } from './request-lapse-notice';
import { invalidateStylistIcalFeedFromCron } from './stylist-ical-cache';
import { changedTreatwellSyncStatus, getTreatwellApiConfiguration } from './treatwell-api';

const lateInclude = {
  user: { select: { email: true, name: true, phone: true } },
  stylist: { select: { name: true, treatwellExternalId: true } },
  service: { select: { id: true, name: true, price: true, duration: true, treatwellExternalId: true } },
  paymentAttempt: { select: linkedDepositSelect },
} as const;

/**
 * The late-arrival rule (docs/superpowers/specs/2026-10-16-late-arrival-auto-cancel-design.md),
 * run by the calendar-sync cron after its own gates: a CONFIRMED booking whose
 * customer staff have not marked arrived 15 minutes after its start is
 * cancelled, its taken deposit kept as for a no-show, the customer emailed 30
 * minutes later (a restore meanwhile drops the mail), and the stylist's busy
 * feed refreshed so Fresha can resell the chair. Each booking closes in its
 * own Serializable transaction behind a conditional write, so a staff
 * "Arrived" racing this run always wins.
 */
export async function cancelLateArrivals(
  now: Date,
  options: { limit?: number } = {},
): Promise<{ enabled: boolean; cancelled: number; skipped: number; failed: number }> {
  // The live row, never the day-cached settings: this closes bookings and keeps money.
  const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { lateAutoCancelSince: true } });
  const since = settings?.lateAutoCancelSince ?? null;
  if (!since) return { enabled: false, cancelled: 0, skipped: 0, failed: 0 };
  const window = lateCancelWindow(now, since);
  const due = await prisma.appointment.findMany({
    where: { status: 'CONFIRMED', arrivedAt: null, date: { gt: window.gt, gte: window.gte, lte: window.lte } },
    select: { id: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: options.limit ?? 50,
  });
  let cancelled = 0;
  let skipped = 0;
  let failed = 0;
  if (due.length === 0) return { enabled: true, cancelled, skipped, failed };
  const salonPhone = await readSalonPhoneForLapseNotice(prisma);
  const plans: Awaited<ReturnType<typeof planDepositForClosing>>[] = [];
  for (const { id } of due) {
    try {
      const done = await runSerializableWithRetry(async (tx) => {
        const current = await tx.appointment.findUnique({ where: { id }, include: lateInclude });
        // Still due: CONFIRMED, not arrived, and still in the late window — staff
        // may have moved it (or approved its reschedule) since the candidate read.
        if (!current || !isLateCancelCandidate(current, since, now)) return null;
        const api = getTreatwellApiConfiguration();
        const closed = await tx.appointment.updateMany({
          where: { id, status: 'CONFIRMED', arrivedAt: null, date: current.date },
          data: {
            status: 'CANCELLED',
            lateCancelledAt: now,
            notificationVersion: { increment: 1 },
            rescheduleRequestedDate: null,
            rescheduleRequestedAt: null,
            // Same as a staff cancellation: undo anything already sent to Treatwell.
            treatwellSyncStatus: changedTreatwellSyncStatus({
              apiReady: api.enabled && api.configured,
              treatwellBookingId: current.treatwellBookingId,
              stylistExternalId: current.stylist.treatwellExternalId,
              serviceExternalId: current.service.treatwellExternalId,
            }),
            treatwellSyncError: null,
          },
        });
        // Staff tapped "Arrived", or moved it, since the re-read (the write's
        // status, arrivedAt and date guards): theirs wins.
        if (closed.count !== 1) return null;
        // A no-show keeps its deposit (owner policy 2026-10-16). A capture in
        // flight throws DEPOSIT_IN_PROGRESS: the whole closing rolls back and
        // the next run tries again.
        const money = await planDepositForClosing(tx, id, { closing: 'CANCEL', refund: false, reason: 'STAFF_CANCELLED', requestedById: null, now });
        const updated = await tx.appointment.findUnique({ where: { id }, include: lateInclude });
        if (!updated) throw new BookingError('APPOINTMENT_NOT_FOUND');
        // The outbox itself skips an undeliverable (walk-in or erased) address.
        const queued = await enqueueAppointmentNotification(tx, 'LATE_CANCELLED', { ...updated, paymentAttempt: money.paymentAttempt }, {
          salonPhone,
          ...(money.outcome ? { depositOutcome: money.outcome } : {}),
          // Held back for the restore grace: a restore meanwhile drops it unsent.
          notBefore: new Date(now.getTime() + LATE_CANCEL_EMAIL_DELAY_MINUTES * 60_000),
        });
        await appendAuditEvent({ actorUserId: null, action: 'APPOINTMENT.LATE_AUTO_CANCELLED', targetType: 'Appointment', targetId: id, metadata: {
          from: 'CONFIRMED', to: 'CANCELLED', start: current.date.toISOString(),
          minutesLate: Math.floor((now.getTime() - current.date.getTime()) / 60_000), notified: Boolean(queued),
          ...(money.outcome ? { deposit: money.outcome, depositPence: money.amountPence } : {}),
        } }, tx);
        return money;
      });
      if (done) {
        cancelled++;
        plans.push(done);
      } else skipped++;
    } catch (error) {
      if (error instanceof BookingError && error.code === 'DEPOSIT_IN_PROGRESS') {
        skipped++;
        continue;
      }
      console.error('Late-arrival cancellation failed:', { appointmentId: id, ...describeFault(error) });
      failed++;
    }
  }
  if (cancelled > 0) {
    // The chair is free: Fresha may resell it. The feed's one-day safety net
    // heals a failed drop, so never fail the run.
    try {
      invalidateStylistIcalFeedFromCron();
    } catch (error) {
      console.error('Dropping the busy-feed cache after late cancellations failed:', describeFault(error));
    }
  }
  // KEPT needs no Square call; kept for symmetry with every other closing (never throws).
  for (const plan of plans) await settleDepositAfterCommit(prisma, plan);
  return { enabled: true, cancelled, skipped, failed };
}
