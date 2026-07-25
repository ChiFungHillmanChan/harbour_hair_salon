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

/**
 * Wall-clock budget for one cron run, in ms. Deliberately below the route's
 * `maxDuration = 60` so the handler can finish cleanly and return a report
 * instead of being killed mid-send.
 */
export const SEND_BUDGET_MS = 45_000;

/**
 * Whether the run still has room to attempt another email.
 *
 * The route can queue up to 200 sends (100 reminders + 100 review requests) and
 * Resend is rate-limited, so a full batch can exceed the function timeout. Both
 * loops mark each row as sent immediately, which makes the work resumable — so
 * stopping early is safe: the next daily run picks up whatever was deferred,
 * and the 36h reminder window is deliberately wider than the 24h cron interval
 * to absorb exactly this.
 */
export function hasSendBudgetLeft(
  startedAt: number,
  now: number,
  budgetMs: number = SEND_BUDGET_MS,
): boolean {
  return now - startedAt < budgetMs;
}
