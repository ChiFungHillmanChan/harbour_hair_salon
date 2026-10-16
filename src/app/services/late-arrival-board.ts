import 'server-only';
import prisma from '@/app/lib/prisma';
import { ARRIVAL_EARLY_MINUTES, LATE_ARRIVAL_LOOKBACK_MINUTES, LATE_CANCEL_RESTORE_HOURS } from '@/app/lib/booking-constants';
import { lateCancelDueAt } from '@/app/lib/late-arrival';

// Admin → Schedule's arrivals panel
// (docs/superpowers/specs/2026-10-16-late-arrival-auto-cancel-design.md §4.4).

export type LateArrivalBoard = {
  /** Admin → Settings has the late-arrival rule switched on. */
  ruleOn: boolean;
  /** CONFIRMED bookings not marked arrived, from an hour before their start to the lookback after it. */
  due: {
    id: string; date: string; customerName: string | null; stylistName: string; serviceName: string;
    /** When the rule will cancel it (ISO), or null when the rule is off or the booking predates switching it on. */
    cancelsAt: string | null;
  }[];
  /** The rule's cancellations still inside the restore window. */
  lateCancelled: {
    id: string; date: string; customerName: string | null; stylistName: string; serviceName: string;
    lateCancelledAt: string;
    /** The LATE_CANCELLED email has already gone: staff tell the customer in person that the booking stands. */
    customerEmailed: boolean;
  }[];
};

/** Admin → Schedule's arrivals panel: who is due in (or late), and what the rule cancelled in the last day. */
export async function getLateArrivalBoard(now: Date = new Date()): Promise<LateArrivalBoard> {
  const minute = 60_000;
  const [settings, due, cancelled] = await Promise.all([
    // The row, not the day-cached settings: the panel must agree with the cron.
    prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { lateAutoCancelSince: true } }),
    prisma.appointment.findMany({
      where: {
        status: 'CONFIRMED', arrivedAt: null,
        date: { gte: new Date(now.getTime() - LATE_ARRIVAL_LOOKBACK_MINUTES * minute), lte: new Date(now.getTime() + ARRIVAL_EARLY_MINUTES * minute) },
      },
      select: { id: true, date: true, user: { select: { name: true } }, stylist: { select: { name: true } }, service: { select: { name: true } } },
      orderBy: [{ date: 'asc' }, { id: 'asc' }], take: 50,
    }),
    prisma.appointment.findMany({
      where: { status: 'CANCELLED', lateCancelledAt: { gte: new Date(now.getTime() - LATE_CANCEL_RESTORE_HOURS * 60 * minute) } },
      select: {
        id: true, date: true, lateCancelledAt: true,
        user: { select: { name: true } }, stylist: { select: { name: true } }, service: { select: { name: true } },
        // 'SENT' is the status the outbox writes once the email has gone (notification-outbox-service.ts).
        notifications: { where: { kind: 'LATE_CANCELLED', status: 'SENT' }, select: { id: true }, take: 1 },
      },
      orderBy: [{ lateCancelledAt: 'desc' }, { id: 'asc' }], take: 50,
    }),
  ]);
  const since = settings?.lateAutoCancelSince ?? null;
  return {
    ruleOn: Boolean(since),
    due: due.map((row) => ({
      id: row.id, date: row.date.toISOString(), customerName: row.user.name, stylistName: row.stylist.name, serviceName: row.service.name,
      // Only a booking the rule will actually reach shows a cancellation time.
      cancelsAt: since && row.date > since ? lateCancelDueAt(row.date).toISOString() : null,
    })),
    lateCancelled: cancelled.map((row) => ({
      id: row.id, date: row.date.toISOString(), customerName: row.user.name, stylistName: row.stylist.name, serviceName: row.service.name,
      lateCancelledAt: row.lateCancelledAt!.toISOString(), customerEmailed: row.notifications.length > 0,
    })),
  };
}
