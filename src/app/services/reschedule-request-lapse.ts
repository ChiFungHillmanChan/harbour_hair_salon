import 'server-only';
import prisma from '@/app/lib/prisma';
import { appendAuditEvent } from '@/app/lib/audit';
import { isRescheduleRequestMoot, RESCHEDULE_REQUEST_LEAD_HOURS } from '@/app/lib/reschedule-request';
import { runSerializableWithRetry } from './booking-service';
import { enqueueAppointmentNotification } from './notification-outbox-service';

const lapseInclude = {
  user: { select: { email: true, name: true, phone: true } },
  stylist: { select: { name: true } },
  service: { select: { id: true, name: true, price: true, duration: true } },
} as const;

/**
 * Close reschedule requests nobody answered before the requested time came
 * within 24 hours, or before the booking's original time arrived (a visit that
 * already happened needs no answer). Runs inside the notifications cron (same
 * tick, no extra Neon wake). Each request is cleared and its email queued in
 * one transaction, and only if it is still the same request, so a re-run or a
 * racing staff decision never sends twice. The customer is emailed only while
 * the original booking is still ahead. A row that throws is logged and skipped
 * (it stays due and is retried next tick) so one bad row can never block the
 * rest of the cron.
 */
export async function lapseExpiredRescheduleRequests(now: Date, limit = 50): Promise<{ lapsed: number; failed: number }> {
  const cutoff = new Date(now.getTime() + RESCHEDULE_REQUEST_LEAD_HOURS * 3_600_000);
  const due = await prisma.appointment.findMany({
    where: {
      status: 'CONFIRMED',
      OR: [
        { rescheduleRequestedDate: { lt: cutoff } },
        { date: { lt: now }, rescheduleRequestedDate: { not: null } },
      ],
    },
    select: { id: true },
    orderBy: { rescheduleRequestedDate: 'asc' },
    take: limit,
  });
  let lapsed = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      const done = await runSerializableWithRetry(async (tx) => {
        const current = await tx.appointment.findUnique({ where: { id }, include: lapseInclude });
        if (!current || current.status !== 'CONFIRMED' || !current.rescheduleRequestedAt || !current.rescheduleRequestedDate
          || !isRescheduleRequestMoot({ date: current.date, rescheduleRequestedDate: current.rescheduleRequestedDate }, now)) return false;
        const cleared = await tx.appointment.updateMany({
          where: { id, status: 'CONFIRMED', date: current.date, rescheduleRequestedAt: current.rescheduleRequestedAt },
          data: { rescheduleRequestedDate: null, rescheduleRequestedAt: null },
        });
        if (cleared.count !== 1) return false;
        // No email about a visit that has already happened (isCurrent would drop it anyway).
        if (current.date > now) {
          await enqueueAppointmentNotification(tx, 'RESCHEDULE_LAPSED', current, { requestedDate: current.rescheduleRequestedDate, requestedAt: current.rescheduleRequestedAt });
        }
        await appendAuditEvent({ actorUserId: null, action: 'APPOINTMENT.RESCHEDULE_LAPSED', targetType: 'Appointment', targetId: id, metadata: { to: current.rescheduleRequestedDate.toISOString() } }, tx);
        return true;
      });
      if (done) lapsed++;
    } catch (error) {
      console.error('Lapsing a reschedule request failed:', { appointmentId: id, error: error instanceof Error ? error.name : 'unknown' });
      failed++;
    }
  }
  return { lapsed, failed };
}
