import 'server-only';

// STATUS: NOT WIRED. Square deposit foundation only — nothing in the booking
// flow calls this yet, and production online booking is locked closed until it
// does. See lib/online-booking-lock.ts (SQUARE_DEPOSITS_WIRED).

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validate BEFORE parsing the raw request body. notificationUrl must be the
 * exact configured Square subscription URL, never a request Host header.
 * This authenticates bytes only; a future handler must durably deduplicate
 * event IDs and reconcile provider state before acknowledging the delivery.
 */
export function verifySquareWebhookSignature(input: {
  body: string;
  signature: string | null;
  signatureKey: string;
  notificationUrl: string;
}): boolean {
  const { body, signature, signatureKey, notificationUrl } = input;
  if (!signatureKey.trim() || signatureKey === '[SENSITIVE]' || !notificationUrl || !signature) return false;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const actual = Buffer.from(signature, 'base64');
  // Buffer's decoder tolerates malformed input; only accept canonical Base64.
  if (actual.length !== 32 || actual.toString('base64') !== signature) return false;
  const expected = createHmac('sha256', signatureKey).update(notificationUrl).update(body).digest();
  return timingSafeEqual(actual, expected);
}
