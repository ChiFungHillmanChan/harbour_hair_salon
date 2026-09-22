import type { Availability } from '@prisma/client';
import { isValidSalonTime, resolveSalonDateTime, salonDateKey } from './salon-time';

export type SyncHours = Pick<Availability, 'dayOfWeek' | 'startTime' | 'endTime' | 'isOff'>;
// Must equal the calendar-sync interval in vercel.json (a test enforces it).
// 30, not 15: each tick is a separate Neon wake with a 5-minute idle tail, and
// :00/:30 ticks share their wake with the notifications job.
export const CALENDAR_POLL_MINUTES = 30;
const BUFFER_MS = 15 * 60_000;

/** London opening hours at cron-minute precision, including adjacent-date buffers. */
export function isCalendarSyncWindow(hours: readonly SyncHours[], now = new Date()): boolean {
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
      const end = resolveSalonDateTime(date, row.endTime).utc.getTime() + BUFFER_MS;
      if (currentMinute >= start && currentMinute <= end) return true;
    }
  }
  return false;
}

/** A local timer may tick frequently; only this decision causes a server read. */
export function shouldRefreshCalendar(hours: readonly SyncHours[], now: Date, lastLoaded: Date, visible: boolean): boolean {
  // Follow the cron's import boundaries, allowing its 90-second runtime.
  // An independent timer could otherwise add another full poll delay.
  const interval = CALENDAR_POLL_MINUTES * 60_000;
  const importTick = Math.floor((now.getTime() - 90_000) / interval) * interval;
  return visible && lastLoaded.getTime() < importTick + 90_000 && isCalendarSyncWindow(hours, new Date(importTick));
}
