import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { loadServerModule } from '../../../../test/load-server-module';
import { feedFingerprint, type FreshaWatchState } from '@/app/services/fresha-watch';

const SECRET = 'test-cron-secret';
const URL_A = 'https://calendar-export.fresha.com/a.ics';
const FEED = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:f1', 'DTSTAMP:20261102T090000Z',
  'DTSTART:20991102T110000Z', 'DTEND:20991102T120000Z', 'SUMMARY:Fresha Appointment', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

function authedRequest(): NextRequest {
  return new NextRequest('https://example.test/api/cron/fresha-watch', { headers: { authorization: `Bearer ${SECRET}` } });
}

async function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { await run(); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const ON = { CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true', FRESHA_WATCH_ENABLED: 'true' };

/** Every I/O dependency records its use; '@/app/lib/prisma' is never one of them. */
function loadRoute(options: { open?: boolean; store?: boolean; state?: FreshaWatchState | null; feed?: string } = {}) {
  const used: string[] = [];
  const writes: FreshaWatchState[] = [];
  const route = loadServerModule<{ GET: (request: NextRequest) => Promise<Response> }>('src/app/api/cron/fresha-watch/route.ts', {
    '@/app/lib/prisma': new Proxy({}, { get: () => { throw new Error('the watch route must not reach the database itself'); } }),
    '@/app/services/calendar-sync-schedule': { isScheduledCalendarSyncOpen: async () => { used.push('hours'); return options.open ?? true; } },
    '@/app/services/fresha-watch-state': {
      freshaWatchStore: () => {
        used.push('store');
        return options.store === false ? null : {
          read: async () => options.state ?? null,
          write: async (state: FreshaWatchState) => { writes.push(state); },
        };
      },
    },
    '@/app/services/fresha-watch-connections': {
      readFreshaWatchSnapshot: async () => {
        used.push('snapshot');
        return { locale: 'en-GB', connections: [{ id: 'conn-a', stylistName: 'Funky', googleColorId: null, inboundUrl: URL_A }] };
      },
    },
    '@/app/services/calendar-feed-url': {
      fetchCalendarFeed: async (url: string) => { used.push(`fetch ${url}`); return options.feed ?? FEED; },
      validateCalendarFeedUrl: (url: string) => new URL(url),
    },
    '@/app/services/calendar-sync-service': {
      syncCalendarFeeds: async (deps: { connectionId: string; fetchFeed: (url: string) => Promise<string> }) => {
        used.push(`import ${deps.connectionId}`);
        assert.equal(await deps.fetchFeed(URL_A), options.feed ?? FEED, 'the import gets the text already fetched');
        return [{ connectionId: deps.connectionId, stylistId: 's', provider: 'FRESHA', ok: true, upserted: 1, pruned: 0 }];
      },
    },
    '@/app/lib/google-calendar-config': { freshaMirrorCalendarConfig: () => null },
  });
  return { route, used, writes };
}

test('rejects an unauthenticated request before anything else', async () => {
  const { route, used } = loadRoute();
  await withEnv(ON, async () => {
    assert.equal((await route.GET(new NextRequest('https://example.test/api/cron/fresha-watch'))).status, 401);
  });
  assert.deepEqual(used, []);
});

// The load-bearing tests: this route is scheduled every minute. With either
// switch off it must not even look at the cached hours (a cache miss reads the database).
test('either kill-switch off: nothing runs', async () => {
  for (const vars of [{ FRESHA_WATCH_ENABLED: undefined }, { FRESHA_WATCH_ENABLED: 'TRUE' }, { CALENDAR_SYNC_ENABLED: 'false' }]) {
    const { route, used } = loadRoute();
    await withEnv({ ...ON, ...vars }, async () => {
      assert.deepEqual(await (await route.GET(authedRequest())).json(), { ok: true, skipped: 'disabled' });
    });
    assert.deepEqual(used, [], JSON.stringify(vars));
  }
});

test('outside staff hours: no state, no feed list, no Fresha request', async () => {
  const { route, used } = loadRoute({ open: false });
  await withEnv(ON, async () => {
    assert.equal((await (await route.GET(authedRequest())).json()).skipped, 'outside-opening-hours');
  });
  assert.deepEqual(used, ['hours']);
});

test('without Redis the watch does nothing (it would otherwise import every minute)', async () => {
  const { route, used } = loadRoute({ store: false });
  await withEnv(ON, async () => {
    assert.equal((await (await route.GET(authedRequest())).json()).skipped, 'no-state');
  });
  assert.deepEqual(used, ['hours', 'store']);
});

test('an unchanged Fresha feed is fetched and nothing else happens', async () => {
  const { route, used, writes } = loadRoute({ state: { feeds: { 'conn-a': { imported: feedFingerprint(FEED) } }, importTicks: [] } });
  await withEnv(ON, async () => {
    const body = await (await route.GET(authedRequest())).json();
    assert.equal(body.changed, 0);
  });
  assert.deepEqual(used, ['hours', 'store', 'snapshot', `fetch ${URL_A}`]);
  assert.deepEqual(writes, []);
});

test('a changed feed is imported once from the text already fetched', async () => {
  const { route, used, writes } = loadRoute({ state: { feeds: {}, importTicks: [] } });
  await withEnv(ON, async () => {
    const response = await route.GET(authedRequest());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).imported, 1);
  });
  assert.deepEqual(used, ['hours', 'store', 'snapshot', `fetch ${URL_A}`, 'import conn-a']);
  assert.equal(writes[0].feeds['conn-a'].imported, feedFingerprint(FEED));
});
