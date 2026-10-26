import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { freshaMirrorCalendarConfig } from '@/app/lib/google-calendar-config';
import { describeFault } from '@/app/lib/fault';
import { isScheduledCalendarSyncOpen } from '@/app/services/calendar-sync-schedule';
import { fetchCalendarFeed, validateCalendarFeedUrl } from '@/app/services/calendar-feed-url';
import { syncCalendarFeeds } from '@/app/services/calendar-sync-service';
import { runFreshaWatch } from '@/app/services/fresha-watch';
import { readFreshaWatchSnapshot } from '@/app/services/fresha-watch-connections';
import { freshaWatchStore } from '@/app/services/fresha-watch-state';
import { createGoogleCalendarGateway } from '@/app/services/google-calendar-gateway';

// Every 5 minutes from 15 minutes before the first stylist starts until the
// last one finishes (owner decision 2026-10-26: Fresha bookings reach the
// website and the Google mirror within 5 minutes; nothing runs at night, when
// staff approvals refresh Fresha themselves). This route never touches the
// database by itself: the kill-switches, the cached staff hours, the Redis
// state and the cached feed list all come first, and only a feed that changed
// is imported. docs/agents/neon-budget.md has the budget.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Leaves a feed import (15 s transaction at most) and a few Google calls room inside maxDuration.
  const deadline = Date.now() + 35_000;
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Both switches, above everything else: either off and a tick costs this function call alone.
  if (process.env.CALENDAR_SYNC_ENABLED !== 'true' || process.env.FRESHA_WATCH_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'disabled' });
  }
  try {
    // Ends at closing time, not 15 minutes after it as the half-hourly import does.
    if (!await isScheduledCalendarSyncOpen(new Date(), { afterCloseMs: 0 })) return NextResponse.json({ ok: true, skipped: 'outside-opening-hours' });
  } catch {
    return NextResponse.json({ ok: false, error: 'Calendar opening hours could not be checked.' }, { status: 503 });
  }
  // Without Redis there is no memory of the last feed, and importing on every tick instead would pin Neon awake.
  const store = freshaWatchStore();
  if (!store) return NextResponse.json({ ok: true, skipped: 'no-state' });
  const mirror = freshaMirrorCalendarConfig() ? createGoogleCalendarGateway({ loadConfig: () => freshaMirrorCalendarConfig() }) : null;
  try {
    const result = await runFreshaWatch({
      store,
      loadSnapshot: () => readFreshaWatchSnapshot(),
      fetchFeed: (url) => fetchCalendarFeed(url),
      // The text this tick fetched (same pinned transport), unless the saved URL changed since the list was cached.
      importFeed: (connectionId, feed) => syncCalendarFeeds({
        connectionId,
        fetchFeed: async (url) => (url === validateCalendarFeedUrl(feed.url).toString() ? feed.text : fetchCalendarFeed(url)),
      }),
      mirror,
      deadline,
    });
    return NextResponse.json({ ok: !result.failed, ...result });
  } catch (error) {
    console.error('Fresha watch failed:', describeFault(error));
    return NextResponse.json({ ok: false, error: 'Fresha watch could not complete.' }, { status: 503 });
  }
}
