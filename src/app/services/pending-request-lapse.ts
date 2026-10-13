import 'server-only';
import prisma from '@/app/lib/prisma';
import { appendAuditEvent } from '@/app/lib/audit';
import { hasAppointmentEnded } from '@/app/lib/appointment-timing';
import { runSerializableWithRetry } from './booking-service';
import { enqueueAppointmentNotification } from './notification-outbox-service';
import { isRequestLapseNoticeDue, readSalonPhoneForLapseNotice } from './request-lapse-notice';
import { invalidateStylistIcalFeedFromCron } from './stylist-ical-cache';
import { changedTreatwellSyncStatus, getTreatwellApiConfiguration } from './treatwell-api';

const lapseInclude = {
  user: { select: { email: true, name: true, phone: true } },
  stylist: { select: { name: true, treatwellExternalId: true } },
  service: { select: { id: true, name: true, price: true, duration: true, treatwellExternalId: true } },
} as const;

/**
 * Close booking requests (PENDING) nobody confirmed in time, once their
 * appointment has ENDED. Owner policy: a request lapses when its time passes
 * unanswered — from its start it can no longer be confirmed
 * (updateAppointmentStatus refuses), so leaving it open only kept it at the top
 * of the admin "awaiting confirmation" list forever. It is closed at the end,
 * not the start: a staff "pencil in" is PENDING too and its customer may be in
 * the chair, and a cancelled booking leaves the stylist busy feed at once, so
 * closing it mid-visit would let a marketplace resell the rest of that time.
 * Meanwhile staff can mark it completed (or decline it) from the board. The
 * query takes every started request (`date <= now`, cheap); one that has not
 * ended is re-checked inside its transaction and skipped — neither lapsed nor
 * a failure — until a later run.
 *
 * Each request is cancelled (version bumped, so earlier queued request mail is
 * retired), audited and — if the customer was told it was awaiting
 * confirmation — sent one REQUEST_LAPSED email, all in one transaction and only
 * if it is still the same unanswered request, so a re-run or a racing staff
 * decision never doubles anything. Whether that email goes is decided by
 * isRequestLapseNoticeDue (request-lapse-notice.ts), the rule staff declining a
 * started request also follows: a staff "pencil in" (also PENDING) was never
 * announced to the customer, who has often simply come in, so it is closed
 * silently, as is a backlog older than REQUEST_LAPSE_NOTICE_HOURS. A row that
 * throws is logged and skipped (it stays due and is retried next run); a
 * failed salon-phone read only drops the phone callout.
 *
 * Runs in the notifications cron and the daily housekeeping cron, so requests
 * still lapse while email sending is switched off (the emails then wait in the
 * outbox like every other kind). Both callers are Route Handlers, hence the
 * cron flavour of the busy-feed invalidation.
 */
export async function lapseStartedPendingRequests(now: Date, limit = 50): Promise<{ lapsed: number; failed: number }> {
  const due = await prisma.appointment.findMany({
    where: { status: 'PENDING', date: { lte: now } },
    select: { id: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: limit,
  });
  let lapsed = 0;
  let failed = 0;
  if (due.length === 0) return { lapsed, failed };
  // Once per run: the email tells the customer how to call the salon. A failed
  // read sends the emails without the phone rather than leaving requests open.
  const salonPhone = await readSalonPhoneForLapseNotice(prisma);
  for (const { id } of due) {
    try {
      const done = await runSerializableWithRetry(async (tx) => {
        const current = await tx.appointment.findUnique({ where: { id }, include: lapseInclude });
        if (!current || current.status !== 'PENDING') return false;
        if (!hasAppointmentEnded(current.date, current.durationAtBooking ?? current.service.duration, now)) return false;
        const api = getTreatwellApiConfiguration();
        const closed = await tx.appointment.updateMany({
          where: { id, status: 'PENDING', date: current.date },
          data: {
            status: 'CANCELLED',
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
        if (closed.count !== 1) return false;
        const announced = await isRequestLapseNoticeDue(tx, current, now);
        const updated = announced ? await tx.appointment.findUnique({ where: { id }, include: lapseInclude }) : null;
        // The outbox itself skips an undeliverable (walk-in or erased) address.
        const queued = updated ? await enqueueAppointmentNotification(tx, 'REQUEST_LAPSED', updated, { salonPhone }) : null;
        await appendAuditEvent({ actorUserId: null, action: 'APPOINTMENT.LAPSED', targetType: 'Appointment', targetId: id, metadata: {
          from: 'PENDING', to: 'CANCELLED', start: current.date.toISOString(), notified: Boolean(queued),
        } }, tx);
        return true;
      });
      if (done) lapsed++;
    } catch (error) {
      console.error('Lapsing a booking request failed:', { appointmentId: id, error: error instanceof Error ? error.name : 'unknown' });
      failed++;
    }
  }
  if (lapsed > 0) {
    // A request held its chair in the marketplaces' busy feed until now. The
    // feed's one-day safety net heals a failed drop, so never fail the run.
    try {
      invalidateStylistIcalFeedFromCron();
    } catch (error) {
      console.error('Dropping the busy-feed cache after request lapses failed:', error instanceof Error ? error.name : 'unknown');
    }
  }
  return { lapsed, failed };
}
