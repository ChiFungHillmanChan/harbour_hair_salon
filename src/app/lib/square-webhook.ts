import 'server-only';

// Used by the Square webhook route (app/api/webhooks/square/route.ts, phase S4
// of docs/superpowers/specs/2026-10-13-square-deposits-design.md), which
// stores each event once (services/square-webhook-events.ts) before acting on it.

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validate BEFORE parsing the raw request body. notificationUrl must be the
 * exact configured Square subscription URL, never a request Host header.
 * This authenticates bytes only; the handler durably deduplicates event IDs
 * and never trusts an event beyond moving payment rows forward.
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

/**
 * The request body as text (UTF-8, as `request.text()` decodes it), or null
 * once it is longer than `limit` bytes — refused from the declared length
 * when there is one, and otherwise while reading, so an oversized body is
 * never held in memory.
 */
export async function readCappedBody(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
