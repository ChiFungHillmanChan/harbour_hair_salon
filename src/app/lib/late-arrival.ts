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

/** Prisma `date` bounds for the cron's candidate query (`createdAt` must be after `since` too). */
export function lateCancelWindow(now: Date, since: Date): { gt: Date; gte: Date; lte: Date } {
  return {
    gt: since,
    gte: new Date(now.getTime() - LATE_ARRIVAL_LOOKBACK_MINUTES * MINUTE),
    lte: new Date(now.getTime() - LATE_ARRIVAL_CANCEL_MINUTES * MINUTE),
  };
}

/** What the rule reads of a booking. */
export type LateCancelRow = {
  status: string;
  arrivedAt: Date | string | null;
  date: Date | string;
  /** When the booking was made: one made before the switch-on was made under the old terms. */
  createdAt: Date | string;
  /** An open customer reschedule request: the customer has contacted the salon, so staff answer it instead. */
  rescheduleRequestedAt?: Date | string | null;
};

/**
 * Whether the rule will ever reach this booking, whatever the time now: it is
 * on, the booking is CONFIRMED, nobody marked it arrived, no reschedule
 * request is open, and it was both made and starts after the switch-on.
 */
export function lateCancelReaches(row: LateCancelRow, since: Date | null): boolean {
  if (!since || row.status !== 'CONFIRMED' || row.arrivedAt || row.rescheduleRequestedAt) return false;
  return ms(row.date) > since.getTime() && ms(row.createdAt) > since.getTime();
}

/** The rule cancels this booking now (the cron's candidate query and its in-transaction re-check). */
export function isLateCancelCandidate(row: LateCancelRow, since: Date | null, now: Date = new Date()): boolean {
  if (!since || !lateCancelReaches(row, since)) return false;
  const window = lateCancelWindow(now, since);
  const start = ms(row.date);
  return start >= window.gte.getTime() && start <= window.lte.getTime();
}

export function isLateCancelRestorable(lateCancelledAt: Date | string | null, now: Date = new Date()): boolean {
  if (!lateCancelledAt) return false;
  return now.getTime() - ms(lateCancelledAt) <= LATE_CANCEL_RESTORE_HOURS * 60 * MINUTE;
}
