import type { Availability } from '@prisma/client';
import { isValidSalonTime, resolveSalonDateTime, salonDateKey } from './salon-time';

export type SyncHours = Pick<Availability, 'dayOfWeek' | 'startTime' | 'endTime' | 'isOff'>;
// Must equal the calendar-sync interval in vercel.json (a test enforces it).
// 30, not 15: each tick is a separate Neon wake with a 5-minute idle tail, and
// :00/:30 ticks share their wake with the notifications job.
export const CALENDAR_POLL_MINUTES = 30;
const BUFFER_MS = 15 * 60_000;

/**
 * London opening hours at cron-minute precision, including adjacent-date
 * buffers: 15 minutes before the first start and, unless `afterCloseMs` says
 * otherwise, 15 minutes after the last end.
 */
export function isCalendarSyncWindow(hours: readonly SyncHours[], now = new Date(), options: { afterCloseMs?: number } = {}): boolean {
  const afterClose = options.afterCloseMs ?? BUFFER_MS;
  // Vercel starts within the scheduled minute, not necessarily at second zero.
  // Keep the final buffered tick eligible without admitting the following minute.
  const currentMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  const today = salonDateKey(now);
  const noon = new Date(`${today}T12:00:00Z`).getTime();
  for (const offset of [-1, 0, 1]) {
    const day = new Date(noon + offset * 86_400_000);
    const date = day.toISOString().slice(0, 10);
    for (const row of hours) {
      if (row.isOff || row.dayOfWeek !== day.getUTCDay() ||
          !isValidSalonTime(row.startTime) || !isValidSalonTime(row.endTime) || row.startTime >= row.endTime) continue;
      const start = resolveSalonDateTime(date, row.startTime).utc.getTime() - BUFFER_MS;
      const end = resolveSalonDateTime(date, row.endTime).utc.getTime() + afterClose;
      if (currentMinute >= start && currentMinute <= end) return true;
    }
  }
  return false;
}

/** Each working day's staff hours as one buffered span, newest first, from today back a week. */
function recentSyncSpans(hours: readonly SyncHours[], now: Date): { start: number; end: number }[] {
  const noon = new Date(`${salonDateKey(now)}T12:00:00Z`).getTime();
  const spans: { start: number; end: number }[] = [];
  for (let offset = 0; offset >= -7; offset--) {
    const day = new Date(noon + offset * 86_400_000);
    const date = day.toISOString().slice(0, 10);
    const rows = hours.filter((row) => !row.isOff && row.dayOfWeek === day.getUTCDay() &&
      isValidSalonTime(row.startTime) && isValidSalonTime(row.endTime) && row.startTime < row.endTime);
    if (!rows.length) continue;
    spans.push({
      start: Math.min(...rows.map((row) => resolveSalonDateTime(date, row.startTime).utc.getTime())) - BUFFER_MS,
      end: Math.max(...rows.map((row) => resolveSalonDateTime(date, row.endTime).utc.getTime())) + BUFFER_MS,
    });
  }
  return spans;
}

/**
 * The instant a feed's age is measured from. The scheduled import only runs in
 * staff hours (owner decision 2026-11-08: at night only the import stops, the
 * website does not), so a feed is judged by when the import last had the
 * chance to run:
 *   - while the import has been running for at least `freshnessMs`: now;
 *   - after closing: the moment the import paused;
 *   - in the first `freshnessMs` of the morning: the moment it paused the
 *     evening before, because the first ticks have not had time to succeed.
 * A feed that was already failing when the import paused still counts as stale.
 * With no working day in the past week there is nothing to measure from: now.
 */
export function calendarFreshnessReference(hours: readonly SyncHours[], now: Date, freshnessMs: number): Date {
  const [latest, previous] = recentSyncSpans(hours, now).filter((span) => span.start <= now.getTime());
  if (!latest) return now;
  if (now.getTime() > latest.end) return new Date(latest.end);
  if (now.getTime() - latest.start >= freshnessMs || !previous) return now;
  return new Date(previous.end);
}

/** A local timer may tick frequently; only this decision causes a server read. */
export function shouldRefreshCalendar(hours: readonly SyncHours[], now: Date, lastLoaded: Date, visible: boolean): boolean {
  // Follow the cron's import boundaries, allowing its 90-second runtime.
  // An independent timer could otherwise add another full poll delay.
  const interval = CALENDAR_POLL_MINUTES * 60_000;
  const importTick = Math.floor((now.getTime() - 90_000) / interval) * interval;
  return visible && lastLoaded.getTime() < importTick + 90_000 && isCalendarSyncWindow(hours, new Date(importTick));
}

/**
 * Browser time at which a server payload (identified by its `loadedAt`) first
 * reached this tab. Next restores Back/Forward navigations from its router
 * cache without refetching, so a restored payload keeps its ORIGINAL arrival
 * time and is refreshed after the next import, while a fresh one gets `now`.
 * Both sides of the refresh comparison therefore stay on the browser clock.
 */
export function payloadArrival(seen: Map<string, number>, loadedAt: string | undefined, now: number): number {
  if (!loadedAt) return now;
  const first = seen.get(loadedAt);
  if (first !== undefined) return first;
  seen.set(loadedAt, now);
  if (seen.size > 100) seen.delete(seen.keys().next().value as string);
  return now;
}
