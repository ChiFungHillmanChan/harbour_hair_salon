import 'server-only';
import { unstable_cache } from 'next/cache';
import { isCalendarSyncWindow } from './calendar-sync-window';

// Hours are stable configuration. Do not expire this cache on every cron tick:
// that would wake Neon overnight just to learn that the salon is closed.
// Hours/stylist mutations invalidate it immediately. A cache miss still needs
// one DB read (e.g. eviction), so this is not a promise of zero compute usage.
const readSyncHours = unstable_cache(async () => {
  const db = (await import('@/app/lib/prisma')).default;
  return db.availability.findMany({
    where: { stylist: { isActive: true } },
    select: { dayOfWeek: true, startTime: true, endTime: true, isOff: true },
  });
}, ['calendar-sync-hours'], { revalidate: false, tags: ['calendar-sync-hours'] });

export async function isScheduledCalendarSyncOpen(now = new Date()): Promise<boolean> {
  return isCalendarSyncWindow(await readSyncHours(), now);
}
