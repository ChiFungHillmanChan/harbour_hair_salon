/**
 * The fixed sentences background jobs and the email outbox store in
 * `lastError`. Rows outlive deployments and the language switch, so they are
 * stored in English; Admin → Operations translates the ones it recognises by
 * key and shows anything else (older rows, feed and provider text) as stored.
 * operations-messages.test.ts keeps this list and the writers in step.
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
