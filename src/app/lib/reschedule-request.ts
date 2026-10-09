// Pure and client-safe: shared by the customer card, the admin board, the
// request/approve actions and the lapse step, so all agree on "expired".

/** A reschedule request must be for a time at least this far ahead, and lapses inside it. */
export const RESCHEDULE_REQUEST_LEAD_HOURS = 24;

export function isRescheduleRequestExpired(requestedDate: Date | string, now: Date = new Date()): boolean {
  return new Date(requestedDate).getTime() - now.getTime() < RESCHEDULE_REQUEST_LEAD_HOURS * 3_600_000;
}

/**
 * A request nobody can act on any more: its requested time is under 24 hours
 * away, or the booking's ORIGINAL time has already come (moving a visit that
 * has happened would email a "moved" notice and hold a chair for nothing).
 */
export function isRescheduleRequestMoot(
  row: { date: Date | string; rescheduleRequestedDate: Date | string },
  now: Date = new Date(),
): boolean {
  return isRescheduleRequestExpired(row.rescheduleRequestedDate, now) || new Date(row.date).getTime() <= now.getTime();
}

export type RescheduleRequestView =
  | { state: 'none' }
  | { state: 'open' | 'expired'; requestedDate: string; requestedAt: string };

export function rescheduleRequestView(
  row: { date: Date | string; rescheduleRequestedDate: Date | string | null; rescheduleRequestedAt: Date | string | null },
  now: Date = new Date(),
): RescheduleRequestView {
  if (!row.rescheduleRequestedDate || !row.rescheduleRequestedAt) return { state: 'none' };
  const requestedDate = new Date(row.rescheduleRequestedDate).toISOString();
  const requestedAt = new Date(row.rescheduleRequestedAt).toISOString();
  return { state: isRescheduleRequestMoot({ date: row.date, rescheduleRequestedDate: requestedDate }, now) ? 'expired' : 'open', requestedDate, requestedAt };
}
