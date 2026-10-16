import 'server-only';

// The token Google sends back as X-Goog-Channel-Token on every notification
// of a watch channel (docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md §6).
// It is signed under the webhook secret and carries its own expiry, so the
// webhook can check a notification without reading the database, and a token
// copied from an old channel stops working when that channel would have ended.

import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_FORMAT = /^(\d{1,12})\.([0-9a-f]{64})$/;

function sign(secret: string, channelId: string, expiresSec: string): string {
  return createHmac('sha256', secret).update(`${channelId}.${expiresSec}`, 'utf8').digest('hex');
}

/**
 * `<expiry in Unix seconds>.<HMAC-SHA256(secret, "<channelId>.<expiry>") in hex>`:
 * at most 77 characters, within Google's 256.
 */
export function channelToken(secret: string, channelId: string, expiresAt: Date): string {
  const expiresSec = String(Math.floor(expiresAt.getTime() / 1000));
  return `${expiresSec}.${sign(secret, channelId, expiresSec)}`;
}

/**
 * Whether `token` was minted for this channel under this secret (compared
 * timing-safely) and has not expired at `now`.
 */
export function channelTokenMatches(secret: string, channelId: string, token: string, now: Date = new Date()): boolean {
  const parts = TOKEN_FORMAT.exec(token);
  if (!parts) return false;
  const [, expiresSec, given] = parts;
  const expected = Buffer.from(sign(secret, channelId, expiresSec), 'utf8');
  if (!timingSafeEqual(Buffer.from(given, 'utf8'), expected)) return false;
  return Number(expiresSec) * 1000 > now.getTime();
}
