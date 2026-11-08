import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { CalendarFeedError, CALENDAR_WINDOW_DAYS, parseCalendarBusyIntervals } from './calendar-ical';
import { fetchCalendarFeed, MAX_CALENDAR_FEED_BYTES, validateCalendarFeedUrl } from './calendar-feed-url';
import { CALENDAR_PROVIDERS, type CalendarProvider } from './treatwell-sync-coverage';
import { describeFault } from '@/app/lib/fault';
import { storedBusySummary } from './calendar-busy-kind';

export type CalendarSyncResult = {
  connectionId: string; stylistId: string; provider: string;
  ok: boolean; upserted: number; pruned: number;
  skipped?: 'locked' | 'budget'; error?: string;
};
export type CalendarSyncDependencies = {
  db?: PrismaClient;
  now?: Date;
  /**
   * Trusted seam: tests, and the Fresha watch, which hands over the text it
   * has just fetched with the same pinned HTTPS transport.
   */
  fetchFeed?: (url: string) => Promise<string>;
  connectionId?: string;
  /** Only this stylist's connections. */
  stylistId?: string;
  provider?: CalendarProvider;
  /** Only connections that have not succeeded since this instant (or whose last attempt failed). */
  staleBefore?: Date;
  /**
   * Called after a Fresha import whose stored blocks changed. Default: drop
   * the cached Fresha time in Treatwell's view of the busy feeds.
   */
  onFreshaBusyChanged?: () => void | Promise<void>;
};

/** Order-free identity of a stored window: which events, and exactly when. */
function blockSetKey(blocks: { uid: string; start: Date; end: Date }[]): string {
  return blocks.map((block) => `${block.uid}|${block.start.getTime()}|${block.end.getTime()}`).sort().join('\n');
}

async function dropTreatwellFreshaBusy(): Promise<void> {
  // Imported on use: the cache module needs the Next request scope, which tests and scripts lack.
  const { invalidateTreatwellFreshaBusy } = await import('./stylist-ical-cache');
  invalidateTreatwellFreshaBusy();
}

/**
 * One lease per stylist/provider, and a transactional compare-and-set before
 * reconciliation. Failed/partial/stale runs cannot prune last-known blocks.
 * External busy times are never copied to outbound feeds (calendar echo loops),
 * except Google-only time the salon added itself; Fresha never re-exports
 * imported events (verified 2026-09-29).
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
      ...(deps.stylistId ? { stylistId: deps.stylistId } : {}),
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
      const { removed: pruned, changed } = await db.$transaction(async (tx) => {
        const current = await tx.calendarConnection.updateMany({
          where: { id: connection.id, lockToken: token, lockedUntil: { gt: completed }, inboundEnabled: true, inboundUrl: connection.inboundUrl },
          data: { lastSuccessAt: completed, lastError: null, lockedUntil: null, lockToken: null },
        });
        if (!current.count) throw new CalendarFeedError('Calendar configuration changed or the sync lease expired. Run the test again.');
        const scope = { source: connection.provider, stylistId: connection.stylistId };
        // Fresha's blocks feed Treatwell's view of the busy feed (stylist-ical-cache.ts),
        // whose cache must drop only on a real change: the half-hourly import of
        // an unchanged feed must not turn Treatwell's next poll into a Neon wake.
        const before = connection.provider === 'FRESHA'
          ? await tx.externalBusyBlock.findMany({
            where: { ...scope, start: { lt: windowEnd }, end: { gt: completed } },
            select: { externalUid: true, start: true, end: true },
          })
          : null;
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
            summary: storedBusySummary(block.summary), lastSyncAt: completed,
          })) });
        }
        const changed = before !== null
          && blockSetKey(before.map((block) => ({ uid: block.externalUid, start: block.start, end: block.end }))) !== blockSetKey(blocks);
        return { removed, changed };
      }, { timeout: 15_000, maxWait: 5_000 });
      if (changed) {
        // After the commit. A failed drop is healed by the cache's one-day safety net.
        try {
          await (deps.onFreshaBusyChanged ?? dropTreatwellFreshaBusy)();
        } catch (error) {
          console.error('Dropping the Treatwell busy-feed cache after a Fresha import failed:', describeFault(error));
        }
      }
      results.push({ ...base, ok: true, upserted: blocks.length, pruned: pruned.count });
    } catch (error) {
      // A feed problem is already reported to the admin as lastError. Anything
      // else (database, network) would vanish into the generic message.
      if (!(error instanceof CalendarFeedError)) {
        console.error('Calendar sync failed:', { connectionId: connection.id, provider: connection.provider, ...describeFault(error) });
      }
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

/** How old the approved stylist's feeds may be before a staff approval re-imports them first. */
export const APPROVAL_REFRESH_MINUTES = 5;

/**
 * The one refresh both staff approval paths run (a new booking's Confirm and a
 * reschedule request's Approve), outside their transactions: the approved
 * stylist's feeds older than APPROVAL_REFRESH_MINUTES (or failing), so a Fresha
 * sale made since the last import is seen by the slot check that follows. That
 * matters most at night, when the scheduled import is paused.
 *
 * Staff confirming never depends on this (owner decision 2026-11-08): no sync
 * is needed for a hand confirmation, so a feed that cannot be read only means
 * the slot is checked against what the website already knows.
 *
 * The admin's own request already wakes Neon, so this adds no separate wake.
 * The CALENDAR_SYNC_ENABLED kill-switch is checked before any database read.
 * Never throws.
 */
export async function refreshCalendarFeedsBeforeApproval(
  stylistId: string,
  opts: Omit<CalendarSyncDependencies, 'staleBefore' | 'stylistId'> = {},
): Promise<CalendarSyncResult[]> {
  if (process.env.CALENDAR_SYNC_ENABLED !== 'true') return [];
  const now = (opts.now ?? new Date()).getTime();
  try {
    return await syncCalendarFeeds({ ...opts, stylistId, staleBefore: new Date(now - APPROVAL_REFRESH_MINUTES * 60_000) });
  } catch (error) {
    console.error('Calendar refresh before approval failed:', { stylistId, ...describeFault(error) });
    return [];
  }
}
