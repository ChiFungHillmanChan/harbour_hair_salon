import type { PrismaClient } from '@prisma/client';
import { parseIcalBusyIntervals } from './treatwell-ical';

export type SyncResult = {
  stylistId: string;
  ok: boolean;
  upserted: number;
  pruned: number;
  error?: string;
};

type Deps = {
  db?: PrismaClient;
  fetchImpl?: typeof fetch;
  now?: Date;
};

// Abort a stalled feed fetch well inside the serverless function budget.
const FETCH_TIMEOUT_MS = 8_000;
// Reject feeds larger than this before buffering/parsing them in memory.
const MAX_FEED_BYTES = 5 * 1024 * 1024;

/**
 * Pull every stylist's Treatwell iCal feed and reconcile it into
 * ExternalBusyBlock. Fail-safe: if a feed fetch/parse fails for a stylist, that
 * stylist's existing future blocks are LEFT INTACT (no prune) so a transient
 * Treatwell outage can never re-open a slot to double-booking.
 */
export async function syncTreatwellFeeds(deps: Deps = {}): Promise<SyncResult[]> {
  // Lazy-load the real Prisma client only when no db is injected, so unit tests
  // (which pass a fake db) never trigger prisma.ts's eager DB-URL resolution.
  const db = deps.db ?? (await import('@/app/lib/prisma')).default;
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ?? new Date();

  const stylists = await db.stylist.findMany({
    where: { treatwellIcalUrl: { not: null } },
    select: { id: true, treatwellIcalUrl: true },
  });

  const results: SyncResult[] = [];

  for (const s of stylists) {
    const url = s.treatwellIcalUrl as string;
    try {
      const resp = await doFetch(url, {
        headers: { Accept: 'text/calendar' },
        // A hung Treatwell endpoint must not consume the whole function budget.
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!resp.ok) {
        // Do NOT prune — preserve last-known blocks.
        results.push({ stylistId: s.id, ok: false, upserted: 0, pruned: 0, error: `HTTP ${resp.status}` });
        continue;
      }

      // Guard against a hostile/oversized feed being buffered whole into memory.
      const declaredLength = Number(resp.headers?.get?.('content-length') ?? '');
      if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) {
        results.push({ stylistId: s.id, ok: false, upserted: 0, pruned: 0, error: 'feed too large' });
        continue;
      }

      const text = await resp.text();
      if (text.length > MAX_FEED_BYTES) {
        results.push({ stylistId: s.id, ok: false, upserted: 0, pruned: 0, error: 'feed too large' });
        continue;
      }

      const intervals = parseIcalBusyIntervals(text, { now });
      if (intervals === null) {
        // Feed was unreadable (HTML error page, empty/garbage body). Preserve
        // last-known blocks — never prune on an invalid document.
        results.push({ stylistId: s.id, ok: false, upserted: 0, pruned: 0, error: 'invalid or unparseable feed' });
        continue;
      }

      for (const iv of intervals) {
        await db.externalBusyBlock.upsert({
          where: { source_externalUid: { source: 'TREATWELL', externalUid: iv.uid } },
          create: {
            source: 'TREATWELL',
            externalUid: iv.uid,
            stylistId: s.id,
            start: iv.start,
            end: iv.end,
            summary: iv.summary ?? null,
            lastSyncAt: now,
          },
          update: {
            stylistId: s.id,
            start: iv.start,
            end: iv.end,
            summary: iv.summary ?? null,
            lastSyncAt: now,
          },
        });
      }

      // Prune future blocks no longer present in the feed (cancelled on Treatwell).
      // `lastSyncAt: { lt: now }` ensures a slower overlapping run never deletes
      // blocks a newer run just wrote (those carry a later lastSyncAt).
      const seen = intervals.map((iv) => iv.uid);
      const pruned = await db.externalBusyBlock.deleteMany({
        where: {
          source: 'TREATWELL',
          stylistId: s.id,
          start: { gte: now },
          externalUid: { notIn: seen },
          lastSyncAt: { lt: now },
        },
      });

      results.push({ stylistId: s.id, ok: true, upserted: intervals.length, pruned: pruned.count });
    } catch (err) {
      results.push({
        stylistId: s.id,
        ok: false,
        upserted: 0,
        pruned: 0,
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  return results;
}
