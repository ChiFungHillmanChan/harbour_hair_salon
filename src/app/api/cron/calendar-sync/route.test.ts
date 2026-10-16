import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { OPERATIONS_MESSAGES } from '@/app/services/operations-messages';

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
    '@/app/lib/prisma': { backgroundJobState: { upsert: async () => ({}), update: async ({ where, data }: { where: { name: string }; data: Record<string, unknown> }) => { if (where.name === 'calendar-sync') writes.push(data); } } },
    '@/app/services/calendar-sync-service': { syncCalendarFeeds: async () => [{ ok: false, error: 'Calendar could not be reached.' }] },
    '@/app/services/late-arrival-cancel': { cancelLateArrivals: async () => ({ enabled: false, cancelled: 0, skipped: 0, failed: 0 }) },
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
    '@/app/services/late-arrival-cancel': { cancelLateArrivals: async () => { imports++; return { enabled: true, cancelled: 0, skipped: 0, failed: 0 }; } },
  });
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    const response = await route.GET(authedRequest());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).skipped, 'outside-opening-hours');
    assert.equal(queries, 0);
    assert.equal(imports, 0);
  });
});

test('runs the late-arrival step after the sync and records it', async () => {
  const { loadServerModule } = await import('../../../../test/load-server-module');
  const order: string[] = [];
  const jobs: Record<string, unknown>[] = [];
  const route = loadServerModule<{ GET: typeof GET }>('src/app/api/cron/calendar-sync/route.ts', {
    '@/app/services/calendar-sync-schedule': { isScheduledCalendarSyncOpen: async () => true },
    '@/app/lib/prisma': { backgroundJobState: {
      upsert: async ({ where }: { where: { name: string } }) => { jobs.push({ upsert: where.name }); return {}; },
      update: async ({ where, data }: { where: { name: string }; data: Record<string, unknown> }) => { jobs.push({ name: where.name, ...data }); },
    } },
    '@/app/services/calendar-sync-service': { syncCalendarFeeds: async () => { order.push('sync'); return []; } },
    '@/app/services/late-arrival-cancel': { cancelLateArrivals: async () => { order.push('late'); return { enabled: true, cancelled: 1, skipped: 0, failed: 0 }; } },
  });
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    const body = await (await route.GET(authedRequest())).json();
    assert.deepEqual(order, ['sync', 'late']);
    assert.equal(body.lateArrivals.cancelled, 1);
    assert.ok(jobs.some((job) => job.name === 'late-arrival-cancel' && job.lastSucceededAt instanceof Date));
  });
});

test('a failing late-arrival step never fails the sync response', async () => {
  const { loadServerModule } = await import('../../../../test/load-server-module');
  const jobs: Record<string, unknown>[] = [];
  const route = loadServerModule<{ GET: typeof GET }>('src/app/api/cron/calendar-sync/route.ts', {
    '@/app/services/calendar-sync-schedule': { isScheduledCalendarSyncOpen: async () => true },
    '@/app/lib/prisma': { backgroundJobState: {
      upsert: async () => ({}),
      update: async ({ where, data }: { where: { name: string }; data: Record<string, unknown> }) => { jobs.push({ name: where.name, ...data }); },
    } },
    '@/app/services/calendar-sync-service': { syncCalendarFeeds: async () => [] },
    '@/app/services/late-arrival-cancel': { cancelLateArrivals: async () => { throw new Error('boom'); } },
  });
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    const response = await route.GET(authedRequest());
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).lateArrivals, { error: true });
    const row = jobs.find((job) => job.name === 'late-arrival-cancel');
    assert.ok(row && row.lastFailedAt instanceof Date);
    assert.equal(row.lastError, OPERATIONS_MESSAGES.LATE_ARRIVAL_FAILED);
  });
});

test('a late-arrival step that reports failures is recorded as failed but the sync stays 200', async () => {
  const { loadServerModule } = await import('../../../../test/load-server-module');
  const jobs: Record<string, unknown>[] = [];
  const route = loadServerModule<{ GET: typeof GET }>('src/app/api/cron/calendar-sync/route.ts', {
    '@/app/services/calendar-sync-schedule': { isScheduledCalendarSyncOpen: async () => true },
    '@/app/lib/prisma': { backgroundJobState: {
      upsert: async () => ({}),
      update: async ({ where, data }: { where: { name: string }; data: Record<string, unknown> }) => { jobs.push({ name: where.name, ...data }); },
    } },
    '@/app/services/calendar-sync-service': { syncCalendarFeeds: async () => [] },
    '@/app/services/late-arrival-cancel': { cancelLateArrivals: async () => ({ enabled: true, cancelled: 0, skipped: 0, failed: 2 }) },
  });
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    assert.equal((await route.GET(authedRequest())).status, 200);
    const row = jobs.find((job) => job.name === 'late-arrival-cancel');
    assert.ok(row && row.lastFailedAt instanceof Date);
    assert.equal(row.lastError, OPERATIONS_MESSAGES.LATE_ARRIVAL_FAILED);
  });
});

test('the kill-switch and closed hours both keep the late-arrival step from running', async () => {
  const { loadServerModule } = await import('../../../../test/load-server-module');
  let calls = 0;
  for (const [enabled, open] of [[undefined, true], ['true', false]] as const) {
    const route = loadServerModule<{ GET: typeof GET }>('src/app/api/cron/calendar-sync/route.ts', {
      '@/app/services/calendar-sync-schedule': { isScheduledCalendarSyncOpen: async () => open },
      '@/app/lib/prisma': { backgroundJobState: { upsert: async () => { calls++; }, update: async () => { calls++; } } },
      '@/app/services/calendar-sync-service': { syncCalendarFeeds: async () => { calls++; return []; } },
      '@/app/services/late-arrival-cancel': { cancelLateArrivals: async () => { calls++; return { enabled: true, cancelled: 0, skipped: 0, failed: 0 }; } },
    });
    await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: enabled }, async () => {
      assert.equal((await route.GET(authedRequest())).status, 200);
    });
  }
  assert.equal(calls, 0);
});
