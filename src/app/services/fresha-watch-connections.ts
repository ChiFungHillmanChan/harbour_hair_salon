import 'server-only';
import { unstable_cache, updateTag } from 'next/cache';
import { isLocale } from '@/i18n/config';
import type { FreshaWatchSnapshot } from './fresha-watch';

const TAG = 'fresha-watch-connections';

/**
 * The Fresha feeds the minute-by-minute watch reads, from the Data Cache: the
 * watch runs 60 times an hour and must not wake Neon to learn its own list.
 * Admin → Integrations (save) and stylist edits and deletion drop the tag.
 * The day-long timer is only so that a direct SQL edit still heals: at most
 * one wake a day (docs/agents/neon-budget.md). Never return a fallback from
 * inside: a failed read throws out of the cache and the tick answers 503.
 */
export const readFreshaWatchSnapshot = unstable_cache(async (): Promise<FreshaWatchSnapshot> => {
  const db = (await import('@/app/lib/prisma')).default;
  const [connections, settings] = await Promise.all([
    db.calendarConnection.findMany({
      // As the half-hourly import selects them, Fresha only: Treatwell has no export feed.
      where: { provider: 'FRESHA', inboundEnabled: true, inboundUrl: { not: null }, stylist: { isActive: true } },
      select: { id: true, inboundUrl: true, stylist: { select: { name: true, googleColorId: true } } },
      orderBy: { id: 'asc' },
      take: 20,
    }),
    db.siteSettings.findUnique({ where: { id: 'singleton' }, select: { salonNotificationLocale: true } }),
  ]);
  return {
    // The salon's own diary language, as the booking copies use (default Traditional Chinese).
    locale: isLocale(settings?.salonNotificationLocale) ? settings.salonNotificationLocale : 'zh-HK',
    connections: connections.map((connection) => ({
      id: connection.id,
      inboundUrl: connection.inboundUrl!,
      stylistName: connection.stylist.name,
      googleColorId: connection.stylist.googleColorId,
    })),
  };
}, ['fresha-watch-connections'], { revalidate: 24 * 60 * 60, tags: [TAG] });

/** Server Actions only (updateTag). */
export function invalidateFreshaWatchConnections() {
  updateTag(TAG);
}
