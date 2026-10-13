/**
 * True when a booking action's answer means online booking is closed — the
 * nightly pause, or staff switched it off — rather than a failed lookup or a
 * refused time. Availability lookups say `{ ok: false, reason: 'CLOSED' }`;
 * submitBooking and requestReschedule say `code: 'MAINTENANCE'`. Either way
 * the page tells the customer booking is closed and how to book instead.
 */
export function isBookingClosedAnswer(answer: { ok: boolean; reason?: string } | { success: boolean; code?: string }): boolean {
  if ('ok' in answer) return !answer.ok && answer.reason === 'CLOSED';
  return !answer.success && answer.code === 'MAINTENANCE';
}
