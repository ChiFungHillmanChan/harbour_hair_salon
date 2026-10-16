/**
 * The fixed sentences background jobs and the email outbox store in
 * `lastError`. Rows outlive deployments and the language switch, so they are
 * stored in English; Admin → Operations translates the ones it recognises by
 * key and shows anything else (older rows, feed and provider text) as stored.
 * operations-messages.test.ts keeps this list and the writers in step.
 *
 * Several are also STATE KEYS: code finds or tells rows apart by their exact
 * text (a Prisma `where`, an `===` check) — pinned in operations-messages.test.ts
 * (STATE_KEY_SENTENCES). Rewording one in place silently drops existing rows
 * from reconciliation and the attention lists: add a new key and a migration
 * (or code that still recognises the old text) instead.
 */
export const OPERATIONS_MESSAGES = {
  CALENDAR_WORKER_FAILED: 'Calendar worker could not complete. Check database and connection configuration.',
  CALENDAR_PARTIAL_FAILURE: 'Some calendar connections failed. Check Integrations; previous busy periods were retained.',
  DELIVERY_LEASE_RECOVERED: 'Expired delivery lease recovered; delivery eligibility will be rechecked.',
  NOTIFICATION_EXPIRED: 'Expired notification; personal payload removed.',
  HOUSEKEEPING_FAILED: 'Housekeeping failed. Check database availability and retention backlog.',
  NOTIFICATION_WORKER_FAILED: 'Notification worker failed. Check database and provider configuration.',
  SOME_NOTIFICATIONS_FAILED: 'Some notifications failed; inspect the notification queue.',
  RETRY_WINDOW_EXPIRED: 'Retry window expired. Check provider delivery logs before any manual resend.',
  DELIVERY_FAILED_REPEATEDLY: 'Delivery failed repeatedly. Check the email provider and sender configuration.',
  DELIVERY_RETRY_SCHEDULED: 'Delivery failed. A retry is scheduled; check provider status and sender configuration.',
  CUSTOMER_ERASED: 'Customer data erased; never sent.',
  // Card deposits (services/payment-attempts.ts). Our own words only: Square's
  // error text is never stored.
  PAYMENT_DECLINED: 'Square declined the deposit, or the card could not be verified. Nothing was booked or charged.',
  PAYMENT_NOT_SENT: 'Square payments were unavailable, so the deposit was never sent. Nothing was charged.',
  // Square refused the request itself (401/403/404, any 4xx but 400/402): the
  // website's access token, permissions or location — never the customer's card.
  PAYMENT_SETUP_REFUSED: 'Square refused the deposit request because of the Square setup on this website (access token, permissions or location), so nothing was held or charged. Check the Square configuration in Vercel.',
  PAYMENT_OUTCOME_UNKNOWN: 'Square did not confirm the deposit authorization and could not be asked to cancel it. Re-check this payment; Square releases an uncaptured hold when it expires.',
  PAYMENT_RELEASED_UNCONFIRMED: 'Square did not confirm the deposit authorization, so it was cancelled by its idempotency key. Nothing was booked.',
  PAYMENT_RELEASED_NOT_BOOKED: 'The booking could not be saved after the deposit was authorized, so the hold was released.',
  PAYMENT_RELEASED_REPEAT: 'The same booking request had already been made, so this second hold was released.',
  PAYMENT_RELEASE_FAILED: 'Releasing this deposit hold failed. Re-check the payment; Square cancels an uncaptured hold when it expires.',
  // Taking (capturing) a deposit when staff confirm the request, and holds
  // that run out first (services/deposit-lifecycle.ts).
  PAYMENT_HOLD_EXPIRED: 'The card hold expired before the request was confirmed, so the request was closed. Nothing was taken.',
  PAYMENT_HOLD_CANCELLED: 'Square had already cancelled this hold (it expired or was released), so the deposit could not be taken.',
  PAYMENT_CHECK_FAILED: 'Square could not be reached to check this deposit before taking it. Nothing was taken; the hold is unchanged.',
  PAYMENT_MISMATCH: 'The payment Square holds does not match this deposit (amount or reference), so it was not taken. Check it in Square.',
  PAYMENT_CAPTURE_REFUSED: 'Square refused to take this deposit. The hold is unchanged and the request was not confirmed.',
  PAYMENT_CAPTURE_UNKNOWN: 'Square did not confirm whether this deposit was taken. Confirming the request again re-checks Square first; the deposit is never taken twice.',
  PAYMENT_CAPTURED_NOT_CONFIRMED: 'The deposit was taken but the booking was not confirmed. Confirm the request again (the deposit is not taken twice), or decline it to refund the deposit.',
  // Reconciliation and the Square webhook (services/payment-reconciliation.ts,
  // services/square-webhook-events.ts).
  PAYMENT_ORPHAN_RELEASED: 'No booking was made with this deposit hold, so it was released. Nothing was taken.',
  PAYMENT_LATE_CAPTURE_REFUNDED: 'Square took this deposit although its booking had closed or was never made, so it is being refunded in full.',
  PAYMENT_UNKNOWN_CANCELLING: 'Square never confirmed this deposit authorization. It is cancelled by its idempotency key again every day until any hold would have run out (7 days). Nothing was booked.',
  // The late-arrival rule that rides the calendar-sync cron (services/late-arrival-cancel.ts).
  LATE_ARRIVAL_FAILED: 'The late-arrival check could not complete. Bookings were left as they were; it runs again with the next calendar sync.',
  // Writing bookings to the salon's Google Calendar (services/google-calendar-push.ts).
  // Our own words only: Google's error text is never stored.
  GOOGLE_PUSH_FAILED: 'This booking could not be written to Google Calendar: Google was unavailable or refused access to the website. It is tried again with the next calendar sync; if it keeps failing, check the Google Calendar settings in Vercel and that the calendar is shared with the service account.',
  GOOGLE_PUSH_REFUSED: 'Google Calendar refused the event for this booking. It is tried again with the next calendar sync; if it keeps failing, the booking is still correct on the website, but its Google copy is out of date.',
  // Reading the salon's Google Calendar (services/google-calendar-pull.ts).
  GOOGLE_PULL_FAILED: 'The Google Calendar check could not complete, so busy time added in Google and website events changed there were not read this time. The busy time last read from Google is kept; the check runs again with the next calendar sync or change in Google. If it keeps failing, check the Google Calendar settings in Vercel and that the calendar is shared with the service account.',
  GOOGLE_EVENT_NOT_KEPT: 'Google Calendar did not keep the event for this booking as the website wrote it: either Google changed the event itself, or someone edited it in Google straight after the website wrote it. The website does not write it back again within 10 minutes of its own write, so the two cannot undo each other in a loop; the next calendar sync writes it again. If this keeps appearing, Google is changing the event: the booking is still correct on the website.',
  // The Google Calendar job riding calendar-sync and housekeeping, and Sync now (services/google-calendar-job.ts).
  GOOGLE_SYNC_FAILED: 'The Google Calendar sync could not complete: bookings were not all written to Google, or changes made in Google were not read. The bookings on the website, and the busy time last read from Google, were kept; it runs again with the next calendar sync. If it keeps failing, check the Google Calendar settings in Vercel and that the calendar is shared with the service account.',
  GOOGLE_CHANNEL_FAILED: 'Google Calendar change notifications could not be set up or renewed, so changes made in Google reach the website only with the next calendar sync (every 30 minutes during staff hours) instead of within a minute. Housekeeping tries again tomorrow. If it keeps failing, check the Google Calendar settings in Vercel and that the calendar is shared with the service account.',
  GOOGLE_EVENTS_FAILED: 'Some bookings could not be written to Google Calendar. Each is tried again with the next calendar sync; the bookings are still correct on the website. If this keeps appearing, check the Google Calendar settings in Vercel and that the calendar is shared with the service account.',
} as const;

export type OperationsMessageKey = keyof typeof OPERATIONS_MESSAGES;

/** The dictionary key for a stored sentence, or null when it is not one of ours. */
export function operationsMessageKey(text: string | null | undefined): OperationsMessageKey | null {
  if (!text) return null;
  for (const [key, message] of Object.entries(OPERATIONS_MESSAGES)) {
    if (message === text) return key as OperationsMessageKey;
  }
  return null;
}
