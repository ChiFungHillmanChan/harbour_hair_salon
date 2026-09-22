import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from './route';

const SECRET = 'test-cron-secret';

function authedRequest(): NextRequest {
  return new NextRequest('https://example.test/api/cron/calendar-sync', {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

// The load-bearing test. `syncCalendarFeeds()` opens with a DB query, which
// wakes Neon's compute and bills CU-hours even when the run is a no-op. If this
// ever returns anything but `skipped`, the kill-switch has drifted below the
// sync call and the cost regression is back.
test('returns without running the sync when CALENDAR_SYNC_ENABLED is not "true"', async () => {
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: undefined }, async () => {
    const response = await GET(authedRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, skipped: 'disabled', results: [] });
  });
});

test('treats any value other than "true" as disabled', async () => {
  for (const value of ['false', '1', 'TRUE', 'yes', '']) {
    await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: value }, async () => {
      const body = await (await GET(authedRequest())).json();
      assert.equal(body.skipped, 'disabled', `expected "${value}" to be treated as disabled`);
    });
  }
});

// Auth must stay above the kill-switch: an unauthenticated caller should never
// learn whether the sync is enabled.
test('rejects an unauthenticated request even while disabled', async () => {
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: undefined }, async () => {
    const response = await GET(new NextRequest('https://example.test/api/cron/calendar-sync'));
    assert.equal(response.status, 401);
  });
});

test('fails closed when CRON_SECRET is unset', async () => {
  await withEnv({ CRON_SECRET: undefined, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    const response = await GET(authedRequest());
    assert.equal(response.status, 500);
  });
});

test('an enabled failed sync persists a safe failure status for the operations page', async () => {
  const { loadServerModule } = await import('../../../../test/load-server-module');
  const writes: Record<string, unknown>[] = [];
  const route = loadServerModule<{ GET: typeof GET }>('src/app/api/cron/calendar-sync/route.ts', {
    '@/app/services/calendar-sync-schedule': { isScheduledCalendarSyncOpen: async () => true },
    '@/app/lib/prisma': { backgroundJobState: { upsert: async () => ({}), update: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); } } },
    '@/app/services/calendar-sync-service': { syncCalendarFeeds: async () => [{ ok: false, error: 'Calendar could not be reached.' }] },
  });
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    assert.equal((await route.GET(authedRequest())).status, 502);
    assert.ok(writes[0].lastFailedAt instanceof Date);
    assert.ok(String(writes[0].lastError).includes('previous busy periods were retained'));
    assert.equal(JSON.parse(String(writes[0].lastResultJson)).failed, 1);
  });
});

test('closed-hours ticks do not access job state or run a feed import', async () => {
  const { loadServerModule } = await import('../../../../test/load-server-module');
  let queries = 0;
  let imports = 0;
  const route = loadServerModule<{ GET: typeof GET }>('src/app/api/cron/calendar-sync/route.ts', {
    '@/app/services/calendar-sync-schedule': { isScheduledCalendarSyncOpen: async () => false },
    '@/app/lib/prisma': { backgroundJobState: { upsert: async () => { queries++; }, update: async () => { queries++; } } },
    '@/app/services/calendar-sync-service': { syncCalendarFeeds: async () => { imports++; return []; } },
  });
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    const response = await route.GET(authedRequest());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).skipped, 'outside-opening-hours');
    assert.equal(queries, 0);
    assert.equal(imports, 0);
  });
});
