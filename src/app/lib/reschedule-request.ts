// Pure and client-safe: shared by the customer card, the admin board, the
// request/approve actions and the lapse step, so all agree on "expired".

/** A reschedule request must be for a time at least this far ahead, and lapses inside it. */
export const RESCHEDULE_REQUEST_LEAD_HOURS = 24;

export function isRescheduleRequestExpired(requestedDate: Date | string, now: Date = new Date()): boolean {
  return new Date(requestedDate).getTime() - now.getTime() < RESCHEDULE_REQUEST_LEAD_HOURS * 3_600_000;
}

export type RescheduleRequestView =
  | { state: 'none' }
  | { state: 'open' | 'expired'; requestedDate: string; requestedAt: string };

export function rescheduleRequestView(
  row: { rescheduleRequestedDate: Date | string | null; rescheduleRequestedAt: Date | string | null },
  now: Date = new Date(),
): RescheduleRequestView {
  if (!row.rescheduleRequestedDate || !row.rescheduleRequestedAt) return { state: 'none' };
  const requestedDate = new Date(row.rescheduleRequestedDate).toISOString();
  const requestedAt = new Date(row.rescheduleRequestedAt).toISOString();
  return { state: isRescheduleRequestExpired(requestedDate, now) ? 'expired' : 'open', requestedDate, requestedAt };
}
