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
    '@/app/services/google-calendar-job': { runGoogleCalendarJob: async () => ({ skipped: 'disabled' }) },
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
    '@/app/services/google-calendar-job': { runGoogleCalendarJob: async () => { imports++; return { skipped: 'disabled' }; } },
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
    '@/app/services/google-calendar-job': { runGoogleCalendarJob: async () => ({ skipped: 'disabled' }) },
  });
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    const body = await (await route.GET(authedRequest())).json();
    assert.deepEqual(order, ['sync', 'late']);
    assert.equal(body.lateArrivals.cancelled, 1);
    assert.ok(jobs.some((job) => job.name === 'late-arrival-cancel' && job.lastSucceededAt instanceof Date));
  });
});

test('a feed import that throws still runs the late-arrival and Google steps, answers 503 and logs no message', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  const { loadServerModule } = await import('../../../../test/load-server-module');
  const order: string[] = [];
  const jobs: Record<string, unknown>[] = [];
  const route = loadServerModule<{ GET: typeof GET }>('src/app/api/cron/calendar-sync/route.ts', {
    '@/app/services/calendar-sync-schedule': { isScheduledCalendarSyncOpen: async () => true },
    '@/app/lib/prisma': { backgroundJobState: {
      upsert: async () => ({}),
      update: async ({ where, data }: { where: { name: string }; data: Record<string, unknown> }) => { jobs.push({ name: where.name, ...data }); },
    } },
    '@/app/services/calendar-sync-service': { syncCalendarFeeds: async () => {
      order.push('sync');
      throw Object.assign(new Error('Server has closed the connection to db.secret-host.neon.tech'), { name: 'PrismaClientKnownRequestError', code: 'P1017' });
    } },
    '@/app/services/late-arrival-cancel': { cancelLateArrivals: async () => { order.push('late'); return { enabled: false, cancelled: 0, skipped: 0, failed: 0 }; } },
    '@/app/services/google-calendar-job': { runGoogleCalendarJob: async () => { order.push('google'); return { skipped: 'disabled' }; } },
  });
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    const response = await route.GET(authedRequest());
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.deepEqual(order, ['sync', 'late', 'google']);
    assert.deepEqual(body.googleCalendar, { skipped: 'disabled' });
    const row = jobs.find((job) => job.name === 'calendar-sync');
    assert.ok(row && row.lastFailedAt instanceof Date);
    assert.equal(row.lastError, 'Calendar worker could not complete. Check database and connection configuration.', 'a state key: never reworded');
    assert.deepEqual(logged, [['Calendar feed import failed:', { error: 'PrismaClientKnownRequestError', code: 'P1017' }]]);
    assert.doesNotMatch(JSON.stringify(logged), /secret-host/, 'the driver message can name the database host');
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
    '@/app/services/google-calendar-job': { runGoogleCalendarJob: async () => ({ skipped: 'disabled' }) },
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
    '@/app/services/google-calendar-job': { runGoogleCalendarJob: async () => ({ skipped: 'disabled' }) },
  });
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    assert.equal((await route.GET(authedRequest())).status, 200);
    const row = jobs.find((job) => job.name === 'late-arrival-cancel');
    assert.ok(row && row.lastFailedAt instanceof Date);
    assert.equal(row.lastError, OPERATIONS_MESSAGES.LATE_ARRIVAL_FAILED);
  });
});

test('the kill-switch and closed hours both keep the late-arrival and Google Calendar steps from running', async () => {
  const { loadServerModule } = await import('../../../../test/load-server-module');
  let calls = 0;
  for (const [enabled, open] of [[undefined, true], ['true', false]] as const) {
    const route = loadServerModule<{ GET: typeof GET }>('src/app/api/cron/calendar-sync/route.ts', {
      '@/app/services/calendar-sync-schedule': { isScheduledCalendarSyncOpen: async () => open },
      '@/app/lib/prisma': { backgroundJobState: { upsert: async () => { calls++; }, update: async () => { calls++; } } },
      '@/app/services/calendar-sync-service': { syncCalendarFeeds: async () => { calls++; return []; } },
      '@/app/services/late-arrival-cancel': { cancelLateArrivals: async () => { calls++; return { enabled: true, cancelled: 0, skipped: 0, failed: 0 }; } },
      '@/app/services/google-calendar-job': { runGoogleCalendarJob: async () => { calls++; return { skipped: 'disabled' }; } },
    });
    await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: enabled }, async () => {
      assert.equal((await route.GET(authedRequest())).status, 200);
    });
  }
  assert.equal(calls, 0);
});

// ── Google Calendar (task G8 of docs/superpowers/plans/2026-10-16-google-calendar-two-way-sync.md) ──

type JobDb = { backgroundJobState: { upsert(args: unknown): Promise<unknown>; update(args: unknown): Promise<unknown> } };

function googleHarness(options: { feeds?: { ok: boolean }[]; google?: () => Promise<unknown> } = {}) {
  return import('../../../../test/load-server-module').then(({ loadServerModule }) => {
    const order: string[] = [];
    const googleCalls: { run: unknown; db: unknown; deadline: unknown; renew: unknown }[] = [];
    const db: JobDb = { backgroundJobState: { upsert: async () => ({}), update: async () => ({}) } };
    const route = loadServerModule<{ GET: typeof GET }>('src/app/api/cron/calendar-sync/route.ts', {
      '@/app/services/calendar-sync-schedule': { isScheduledCalendarSyncOpen: async () => true },
      '@/app/lib/prisma': db,
      '@/app/services/calendar-sync-service': { syncCalendarFeeds: async () => { order.push('sync'); return options.feeds ?? []; } },
      '@/app/services/late-arrival-cancel': { cancelLateArrivals: async () => { order.push('late'); return { enabled: true, cancelled: 0, skipped: 0, failed: 0 }; } },
      '@/app/services/google-calendar-job': {
        runGoogleCalendarJob: async (run: unknown, input: { db: unknown; deadline: unknown; renew?: unknown }) => {
          order.push('google');
          googleCalls.push({ run, db: input.db, deadline: input.deadline, renew: input.renew });
          return options.google ? options.google() : { ok: true, push: { written: 1, deleted: 0, unchanged: 0, failed: 0 }, pull: 'deferred' };
        },
      },
    });
    return { route, order, googleCalls, db };
  });
}

test('the Google Calendar step runs after the late-arrival step, on the same database client, with the function\'s deadline', async () => {
  const h = await googleHarness();
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    const before = Date.now();
    const response = await h.route.GET(authedRequest());
    const deadline = h.googleCalls[0].deadline as number;
    assert.ok(deadline >= before + 180_000 && deadline <= Date.now() + 180_000, 'start of the run + maxDuration');
    assert.equal(response.status, 200);
    assert.deepEqual(h.order, ['sync', 'late', 'google']);
    assert.deepEqual(h.googleCalls.map((call) => call.run), ['calendar-sync']);
    assert.notEqual(h.googleCalls[0].renew, true, 'never replaces the watch channel');
    assert.equal(h.googleCalls[0].db, h.db, 'no second client: the database is already awake');
    assert.deepEqual((await response.json()).googleCalendar, { ok: true, push: { written: 1, deleted: 0, unchanged: 0, failed: 0 }, pull: 'deferred' });
  });
});

test('the Google Calendar step never changes the sync\'s status code', async (t) => {
  t.mock.method(console, 'error', () => {});
  const failing = [
    async () => ({ ok: false, push: 'failed', pull: 'failed' }),
    async () => ({ ok: false, error: true }),
    async () => { throw new Error('module failed to load'); },
  ];
  for (const google of failing) {
    for (const [feeds, status] of [[[], 200], [[{ ok: false }], 502]] as const) {
      const h = await googleHarness({ feeds: [...feeds], google });
      await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
        const response = await h.route.GET(authedRequest());
        assert.equal(response.status, status);
        assert.equal((await response.json()).ok, status === 200);
      });
    }
  }
  const thrown = await googleHarness({ google: async () => { throw new Error('module failed to load'); } });
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    assert.deepEqual((await (await thrown.route.GET(authedRequest())).json()).googleCalendar, { error: true });
  });
});

// End to end through the real job module (services/google-calendar-job.ts),
// with only its I/O replaced.
async function routeWithRealJob(options: { enabled: boolean; pushThrows?: boolean }) {
  const { loadServerModule } = await import('../../../../test/load-server-module');
  const order: string[] = [];
  const jobRows: string[] = [];
  const counts = { googleImports: 0 };
  const db = {
    backgroundJobState: {
      upsert: async ({ where }: { where: { name: string } }) => { jobRows.push(`start:${where.name}`); return {}; },
      update: async ({ where, data }: { where: { name: string }; data: { lastError?: string | null } }) => { jobRows.push(`end:${where.name}:${data.lastError ?? 'ok'}`); return {}; },
    },
    // A live channel and a check of Google that just succeeded: the health check passes.
    googleCalendarSyncState: {
      findUnique: async () => {
        order.push('health');
        return { channelId: 'channel-1', channelExpiresAt: new Date(Date.now() + 86_400_000), lastPullAt: new Date(), lastPullSuccessAt: new Date() };
      },
    },
  };
  const counted = <T extends object>(module: T): T => new Proxy(module, { get(target, key) { counts.googleImports++; return target[key as keyof T]; } });
  const job = loadServerModule('src/app/services/google-calendar-job.ts', {
    '@/app/lib/google-calendar-config': { googleCalendarConfig: () => (options.enabled ? { calendarId: 'c', clientEmail: 'e', privateKey: 'k', webhookSecret: 's' } : null) },
    '@/app/lib/prisma': counted({ __esModule: true, default: db }),
    // The calendar change guard (services/google-calendar-guard.ts): the configured calendar is the recorded one.
    './google-calendar-guard': counted({ guardGoogleCalendarChange: async () => 'same' }),
    './google-calendar-channel': counted({
      ensureGoogleWatchChannel: async () => { order.push('channel'); return 'current'; },
      runPullSingleFlight: async (pull: () => Promise<unknown>) => { order.push('single-flight'); await pull(); },
    }),
    './google-calendar-push': counted({ pushGoogleCalendar: async (input: { mode: string }) => {
      order.push(`push:${input.mode}`);
      if (options.pushThrows) throw new Error('database unavailable');
      return { written: 0, deleted: 0, unchanged: 0, failed: 0 };
    } }),
    './google-calendar-pull': counted({ pullGoogleCalendar: async () => { order.push('pull'); return { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false }; } }),
  });
  const route = loadServerModule<{ GET: typeof GET }>('src/app/api/cron/calendar-sync/route.ts', {
    '@/app/services/calendar-sync-schedule': { isScheduledCalendarSyncOpen: async () => true },
    '@/app/lib/prisma': db,
    '@/app/services/calendar-sync-service': { syncCalendarFeeds: async () => { order.push('sync'); return []; } },
    '@/app/services/late-arrival-cancel': { cancelLateArrivals: async () => { order.push('late'); return { enabled: true, cancelled: 0, skipped: 0, failed: 0 }; } },
    '@/app/services/google-calendar-job': job,
  });
  return { route, order, jobRows, counts };
}

test('with the Google sync off the run makes no Google call and no extra query', async () => {
  const h = await routeWithRealJob({ enabled: false });
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    const response = await h.route.GET(authedRequest());
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).googleCalendar, { skipped: 'disabled' });
  });
  assert.deepEqual(h.order, ['sync', 'late']);
  assert.deepEqual(h.jobRows, ['start:calendar-sync', 'end:calendar-sync:ok', 'start:late-arrival-cancel', 'end:late-arrival-cancel:ok'], 'only the existing job rows');
  assert.equal(h.counts.googleImports, 0);
});

test('with the Google sync on: push the recent changes, then the single-flight pull, recorded in its own job row', async () => {
  const h = await routeWithRealJob({ enabled: true });
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    assert.equal((await h.route.GET(authedRequest())).status, 200);
  });
  assert.deepEqual(h.order, ['sync', 'late', 'push:recent', 'single-flight', 'pull', 'health'], 'no watch-channel work every half hour');
  assert.deepEqual(h.jobRows.slice(-2), ['start:google-calendar', 'end:google-calendar:ok']);
});

test('a Google push that throws is recorded in the google-calendar row and the sync stays 200', async (t) => {
  t.mock.method(console, 'error', () => {});
  const h = await routeWithRealJob({ enabled: true, pushThrows: true });
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    assert.equal((await h.route.GET(authedRequest())).status, 200);
  });
  assert.deepEqual(h.order, ['sync', 'late', 'push:recent', 'single-flight', 'pull', 'health'], 'the pull still runs');
  assert.deepEqual(h.jobRows.slice(-1), [`end:google-calendar:${OPERATIONS_MESSAGES.GOOGLE_SYNC_FAILED}`]);
});

test('the function has room for the feed import plus the Google push and pull', async () => {
  const route = await import('./route');
  assert.ok(route.maxDuration >= 180);
});

