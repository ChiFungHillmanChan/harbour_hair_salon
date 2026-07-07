import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison — guards the cron auth check against a
 * timing side-channel that could otherwise leak the secret byte-by-byte.
 * Pure, dependency-free (no Prisma, no DB URL) so it can be unit tested
 * without any environment setup.
 */
export function safeCompare(a: string, b: string): boolean {
  // Compare BYTE lengths, not `String.length` (UTF-16 code units): a multibyte
  // char (e.g. a raw 0xE9 latin-1 header byte) can share code-unit length while
  // differing in UTF-8 byte length, which makes timingSafeEqual throw (→ a 500
  // instead of a clean 401). Compute the buffers once and length-check them.
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * End of the appointment-reminder lookahead window: `now + 36h`. 36h (not
 * 24h) so a send that fails today is retried on tomorrow's run while still
 * within the window (the cron only runs once per day).
 */
export function reminderWindowEnd(now: Date): Date {
  return new Date(now.getTime() + 36 * HOUR_MS);
}

/**
 * Review-request lookback window: past appointments from 1–14 days ago.
 * `start` is the older bound (14 days ago), `end` is the newer bound (1 day
 * ago) — matching the `date: { gte: start, lte: end }` query shape.
 */
export function reviewWindow(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(now.getTime() - 14 * DAY_MS),
    end: new Date(now.getTime() - DAY_MS),
  };
}
