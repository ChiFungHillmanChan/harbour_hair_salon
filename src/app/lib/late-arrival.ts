// Pure and client-safe: the cron, the admin actions and the arrivals panel all
// decide "is this booking late enough to cancel?" the same way
// (docs/superpowers/specs/2026-10-16-late-arrival-auto-cancel-design.md).
import {
  ARRIVAL_EARLY_MINUTES, LATE_ARRIVAL_CANCEL_MINUTES, LATE_ARRIVAL_LOOKBACK_MINUTES, LATE_CANCEL_RESTORE_HOURS,
} from './booking-constants';

const MINUTE = 60_000;
const ms = (value: Date | string) => new Date(value).getTime();

/** When the rule cancels a booking nobody marked arrived. */
export function lateCancelDueAt(start: Date | string): Date {
  return new Date(ms(start) + LATE_ARRIVAL_CANCEL_MINUTES * MINUTE);
}

/** Staff may record (or clear) an arrival from an hour before the start until the later of its end and the lookback. */
export function isArrivalWindowOpen(start: Date | string, durationMin: number, now: Date = new Date()): boolean {
  const opens = ms(start) - ARRIVAL_EARLY_MINUTES * MINUTE;
  const closes = ms(start) + Math.max(durationMin, LATE_ARRIVAL_LOOKBACK_MINUTES) * MINUTE;
  return now.getTime() >= opens && now.getTime() <= closes;
}

/** Prisma `date` bounds for the cron's candidate query. */
export function lateCancelWindow(now: Date, since: Date): { gt: Date; gte: Date; lte: Date } {
  return {
    gt: since,
    gte: new Date(now.getTime() - LATE_ARRIVAL_LOOKBACK_MINUTES * MINUTE),
    lte: new Date(now.getTime() - LATE_ARRIVAL_CANCEL_MINUTES * MINUTE),
  };
}

export function isLateCancelCandidate(
  row: { status: string; arrivedAt: Date | string | null; date: Date | string },
  since: Date | null,
  now: Date = new Date(),
): boolean {
  if (!since || row.status !== 'CONFIRMED' || row.arrivedAt) return false;
  const window = lateCancelWindow(now, since);
  const start = ms(row.date);
  return start > window.gt.getTime() && start >= window.gte.getTime() && start <= window.lte.getTime();
}

export function isLateCancelRestorable(lateCancelledAt: Date | string | null, now: Date = new Date()): boolean {
  if (!lateCancelledAt) return false;
  return now.getTime() - ms(lateCancelledAt) <= LATE_CANCEL_RESTORE_HOURS * 60 * MINUTE;
}
