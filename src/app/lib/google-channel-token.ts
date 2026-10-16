import 'server-only';

// The token Google sends back as X-Goog-Channel-Token on every notification
// of a watch channel (docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md §6).
// It is derived from the channel id under the webhook secret, so the webhook
// can check a notification without reading the database.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 of the channel id under the webhook secret, in hex (64 characters). */
export function channelToken(secret: string, channelId: string): string {
  return createHmac('sha256', secret).update(channelId, 'utf8').digest('hex');
}

/** Timing-safe: whether `token` is the one minted for this channel and secret. */
export function channelTokenMatches(secret: string, channelId: string, token: string): boolean {
  const expected = Buffer.from(channelToken(secret, channelId), 'utf8');
  const given = Buffer.from(token, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
