'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { verifySession } from '@/app/lib/session';
import { runSerializableWithRetry } from '@/app/services/booking-service';
import { describeAdminMoveClashes, type MoveClash } from '@/app/services/admin-move-clashes';
import {
  enqueueAppointmentNotification,
  dispatchAppointmentNotifications,
} from '@/app/services/notification-outbox-service';
import { changedTreatwellSyncStatus, getTreatwellApiConfiguration } from '@/app/services/treatwell-api';
import { resolveSalonDateTime, SALON_DATE_RE, SALON_TIME_RE } from '@/app/services/salon-time';
import { MIN_DURATION_MINUTES } from '@/app/lib/calendar-geometry';
import { BookingError } from '@/app/services/booking-errors';

const STALE_MESSAGE = 'This appointment has changed. Please refresh and try again.';

const moveSchema = z.object({
  appointmentId: z.string().min(1),
  dateStr: z.string().regex(SALON_DATE_RE, 'Invalid date'),
  time: z.string().regex(SALON_TIME_RE, 'Invalid time'),
  durationMin: z.number().int().min(MIN_DURATION_MINUTES).max(12 * 60),
  stylistId: z.string().min(1),
  overrideClashes: z.boolean(),
  expectedUpdatedAt: z.string().min(1),
});

export type MoveAppointmentInput = z.infer<typeof moveSchema>;

export type MoveAppointmentResult =
  | { success: true }
  | { success: false; error: string }
  | { success: false; clashes: MoveClash[] };

/**
 * Move and/or resize an appointment from the admin day grid.
 *
 * Differs from the customer reschedule path (actions/booking.ts) in four ways,
 * all deliberate:
 *
 *  - It can change the DURATION and the STYLIST, not just the start time.
 *  - Clashes warn instead of refusing. `overrideClashes` lets the salon
 *    deliberately double-book — a blow-dry during colour processing time is
 *    normal practice — but only after being told exactly what it collides with.
 *  - The 24-hour policy does NOT apply. That rule exists to stop *customers*
 *    rearranging same-day work; applying it here would block the exact case this
 *    feature is for, an appointment over-running today.
 *  - `assertOnlineBookingReady` is NOT called. That gate closes *online* booking
 *    when an external calendar feed goes stale; an admin standing in the salon
 *    must still be able to fix today's board.
 */
export async function moveAppointmentByAdmin(input: MoveAppointmentInput): Promise<MoveAppointmentResult> {
  const session = await verifySession();
  if (session.role !== 'ADMIN') {
    return { success: false, error: 'Not authorised' };
  }

  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' };
  }
  const { appointmentId, dateStr, time, durationMin, stylistId, overrideClashes, expectedUpdatedAt } = parsed.data;

  const salon = resolveSalonDateTime(dateStr, time);
  const newDate = salon.utc;
  if (Number.isNaN(newDate.getTime())) {
    return { success: false, error: 'Invalid date or time' };
  }

  try {
    const outcome = await runSerializableWithRetry(async (tx) => {
      const current = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          user: { select: { email: true, name: true, phone: true } },
          stylist: { select: { name: true, treatwellExternalId: true } },
          service: { select: { name: true, price: true, duration: true, requiresPatchTest: true, treatwellExternalId: true } },
        },
      });
      if (!current) throw new BookingError('Appointment not found');
      if (current.status === 'CANCELLED') {
        throw new BookingError('A cancelled appointment cannot be moved — create a new booking.');
      }

      // Always inside the transaction, on both paths: `overrideClashes` decides
      // whether a clash ABORTS the write, never whether the write is checked
      // against the same snapshot it commits against.
      const clashes = await describeAdminMoveClashes(tx, {
        appointmentId,
        stylistId,
        start: newDate,
        durationMin,
        userId: current.userId,
        requiresPatchTest: current.service.requiresPatchTest,
      });
      if (clashes.length > 0 && !overrideClashes) {
        return { kind: 'clashes' as const, clashes };
      }

      const oldDate = current.date;
      const startMoved = oldDate.getTime() !== newDate.getTime();
      const stylistChanged = current.stylistId !== stylistId;

      const treatwellApi = getTreatwellApiConfiguration();
      const treatwellSyncStatus = changedTreatwellSyncStatus({
        apiReady: treatwellApi.enabled && treatwellApi.configured,
        treatwellBookingId: current.treatwellBookingId,
        stylistExternalId: current.stylist.treatwellExternalId,
        serviceExternalId: current.service.treatwellExternalId,
      });

      // Optimistic guard. The board reloads every 60 seconds, so two admins can
      // easily be dragging the same block; this turns that into an explicit
      // "refresh and try again" instead of a silent overwrite.
      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, updatedAt: new Date(expectedUpdatedAt) },
        data: {
          date: newDate,
          durationAtBooking: durationMin,
          stylistId,
          // A reminder already sent describes the OLD time.
          ...(startMoved ? { reminderSent: false } : {}),
          treatwellSyncStatus,
          treatwellSyncError: null,
          notificationVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new BookingError(STALE_MESSAGE);

      // Only a changed arrival time or a changed stylist is news to the customer.
      // A pure resize leaves their plans untouched, so it stays silent.
      if ((startMoved || stylistChanged) && current.status === 'CONFIRMED') {
        const updated = await tx.appointment.findUnique({
          where: { id: appointmentId },
          include: {
            user: { select: { email: true, name: true, phone: true } },
            stylist: { select: { name: true } },
            service: { select: { name: true, price: true, duration: true } },
          },
        });
        if (!updated) throw new BookingError('Appointment not found');
        await enqueueAppointmentNotification(tx, 'RESCHEDULE', updated, { oldDate });
        return { kind: 'moved' as const, notify: true };
      }

      return { kind: 'moved' as const, notify: false };
    });

    if (outcome.kind === 'clashes') {
      return { success: false, clashes: outcome.clashes };
    }
    if (outcome.notify) {
      await dispatchAppointmentNotifications(appointmentId);
    }

    revalidatePath('/admin');
    revalidatePath('/appointments');
    revalidatePath('/book');
    return { success: true };
  } catch (error) {
    if (error instanceof BookingError) return { success: false, error: error.message };
    console.error('moveAppointmentByAdmin failed', error);
    return { success: false, error: 'Could not move this appointment. Please try again.' };
  }
}
