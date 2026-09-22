import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { CalendarFeedError, CALENDAR_WINDOW_DAYS, parseCalendarBusyIntervals } from './calendar-ical';
import { fetchCalendarFeed, MAX_CALENDAR_FEED_BYTES, validateCalendarFeedUrl } from './calendar-feed-url';
import { CALENDAR_PROVIDERS, type CalendarProvider } from './treatwell-sync-coverage';
import { CALENDAR_POLL_MINUTES } from './calendar-sync-window';

export type CalendarSyncResult = {
  connectionId: string; stylistId: string; provider: string;
  ok: boolean; upserted: number; pruned: number;
  skipped?: 'locked' | 'budget'; error?: string;
};
export type CalendarSyncDependencies = {
  db?: PrismaClient;
  now?: Date;
  /** Trusted test seam; production always uses pinned HTTPS transport. */
  fetchFeed?: (url: string) => Promise<string>;
  connectionId?: string;
  provider?: CalendarProvider;
  /** Only connections that have not succeeded since this instant (or whose last attempt failed). */
  staleBefore?: Date;
};

/**
 * One lease per stylist/provider, and a transactional compare-and-set before
 * reconciliation. Failed/partial/stale runs cannot prune last-known blocks.
 * External busy times are never copied to outbound feeds (calendar echo loops).
 */
export async function syncCalendarFeeds(deps: CalendarSyncDependencies = {}): Promise<CalendarSyncResult[]> {
  const db = deps.db ?? (await import('@/app/lib/prisma')).default;
  const fetchFeed = deps.fetchFeed ?? fetchCalendarFeed;
  const clock = () => deps.now ?? new Date();
  const started = Date.now();
  const connections = await db.calendarConnection.findMany({
    where: {
      inboundEnabled: true, inboundUrl: { not: null },
      // A retired stylist's feed is nobody's business to poll: it cannot affect
      // bookable slots, and a stale marketplace URL left behind would burn Neon
      // compute every cycle and keep writing lastError.
      stylist: { isActive: true },
      provider: deps.provider ?? { in: [...CALENDAR_PROVIDERS] },
      ...(deps.connectionId ? { id: deps.connectionId } : {}),
      ...(deps.staleBefore ? { OR: [{ lastSuccessAt: null }, { lastSuccessAt: { lt: deps.staleBefore } }, { lastError: { not: null } }] } : {}),
    },
    orderBy: { lastAttemptAt: { sort: 'asc', nulls: 'first' } },
    take: 20,
  });
  const results: CalendarSyncResult[] = [];
  for (const connection of connections) {
    const base = { connectionId: connection.id, stylistId: connection.stylistId, provider: connection.provider, upserted: 0, pruned: 0 };
    // Keep enough time for one final bounded feed request and transaction.
    if (Date.now() - started > 40_000) { results.push({ ...base, ok: false, skipped: 'budget' }); continue; }
    const now = clock();
    const token = randomUUID();
    const claimed = await db.calendarConnection.updateMany({
      where: {
        id: connection.id, inboundUrl: connection.inboundUrl, inboundEnabled: true,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      },
      data: { lockToken: token, lockedUntil: new Date(now.getTime() + 90_000), lastAttemptAt: now },
    });
    if (!claimed.count) { results.push({ ...base, ok: true, skipped: 'locked' }); continue; }
    try {
      // Defense in depth also applies to old URLs restored by migration.
      const url = validateCalendarFeedUrl(connection.inboundUrl!).toString();
      const text = await fetchFeed(url);
      if (Buffer.byteLength(text, 'utf8') > MAX_CALENDAR_FEED_BYTES) throw new CalendarFeedError('Calendar feed is too large.');
      const completed = clock();
      const windowEnd = new Date(completed.getTime() + CALENDAR_WINDOW_DAYS * 86_400_000);
      const intervals = parseCalendarBusyIntervals(text, { now: completed, windowEnd });
      // Hash provider-owned UIDs to bound database index size without collisions
      // from truncation. Source and stylist remain separate parts of the key.
      const blocks = intervals.map((interval) => ({ ...interval, uid: createHash('sha256').update(interval.uid).digest('hex') }));
      const pruned = await db.$transaction(async (tx) => {
        const current = await tx.calendarConnection.updateMany({
          where: { id: connection.id, lockToken: token, lockedUntil: { gt: completed }, inboundEnabled: true, inboundUrl: connection.inboundUrl },
          data: { lastSuccessAt: completed, lastError: null, lockedUntil: null, lockToken: null },
        });
        if (!current.count) throw new CalendarFeedError('Calendar configuration changed or the sync lease expired. Run the test again.');
        const scope = { source: connection.provider, stylistId: connection.stylistId };
        // Replace this validated window inside the same transaction: readers
        // never observe an empty intermediate calendar. This avoids thousands
        // of network round trips and works on PostgreSQL, SQLite and SQL Server.
        const removed = await tx.externalBusyBlock.deleteMany({
          where: { ...scope, OR: [{ start: { lt: windowEnd }, end: { gt: completed } }] },
        });
        for (let offset = 0; offset < blocks.length; offset += 100) {
          const batch = blocks.slice(offset, offset + 100);
          // A UID may have moved into the window from an older stored interval.
          // Small batches also stay below each provider's bind-parameter limit.
          await tx.externalBusyBlock.deleteMany({ where: { ...scope, OR: [{ externalUid: { in: batch.map((block) => block.uid) } }] } });
          await tx.externalBusyBlock.createMany({ data: batch.map((block) => ({
            ...scope, externalUid: block.uid, start: block.start, end: block.end,
            summary: null, lastSyncAt: completed,
          })) });
        }
        return removed;
      }, { timeout: 15_000, maxWait: 5_000 });
      results.push({ ...base, ok: true, upserted: blocks.length, pruned: pruned.count });
    } catch (error) {
      const message = error instanceof CalendarFeedError ? error.message : 'Calendar sync failed. Previous busy times were retained.';
      // CAS prevents a slow failure from wiping a new owner's success/lease.
      await db.calendarConnection.updateMany({
        where: { id: connection.id, lockToken: token },
        data: { lastError: message, lockToken: null, lockedUntil: null },
      });
      results.push({ ...base, ok: false, error: message });
    }
  }
  return results;
}

/**
 * Admin-initiated refresh before a check that needs fresh marketplace data
 * (confirming a request). The scheduled import deliberately pauses outside
 * staff hours to save Neon compute, so an evening confirmation would otherwise
 * fail the 90-minute freshness gate until the next morning. The admin's own
 * request is already waking the database, so this adds no separate wake.
 * Respects the CALENDAR_SYNC_ENABLED kill-switch and never throws: a failed
 * import is reported by the readiness check that follows.
 */
export async function refreshStaleCalendarFeeds(deps: Omit<CalendarSyncDependencies, 'staleBefore'> = {}): Promise<CalendarSyncResult[]> {
  if (process.env.CALENDAR_SYNC_ENABLED !== 'true') return [];
  const now = deps.now ?? new Date();
  try {
    return await syncCalendarFeeds({ ...deps, staleBefore: new Date(now.getTime() - CALENDAR_POLL_MINUTES * 60_000) });
  } catch {
    return [];
  }
}
