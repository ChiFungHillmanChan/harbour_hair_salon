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

/** "We couldn't confirm your request in time" is only worth sending this soon after the requested time. */
export const REQUEST_LAPSE_NOTICE_HOURS = 72;

/**
 * Whether a lapsed booking request may still be emailed about. Normally the
 * notifications cron closes a request within half an hour of its time; a
 * backlog (first deploy, crons or sending switched off for a while) is closed
 * silently rather than mailed days later.
 */
export function isRequestLapseNoticeTimely(date: Date | string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(date).getTime() <= REQUEST_LAPSE_NOTICE_HOURS * 3_600_000;
}
