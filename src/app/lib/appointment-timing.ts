// Pure and client-safe: the admin board (in the browser), the status action and
// the booking-request lapse step all decide "has this visit begun?" the same way.

/**
 * True once an appointment's start time has come; it may still be running.
 * From then on a booking request can no longer be confirmed, a visit can be
 * marked completed, and staff cancelling it is tidying the diary rather than
 * news for the customer.
 */
export function hasAppointmentStarted(date: Date | string, now: Date = new Date()): boolean {
  return new Date(date).getTime() <= now.getTime();
}
