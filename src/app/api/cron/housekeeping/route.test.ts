import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { loadServerModule } from '../../../../test/load-server-module';
import { OPERATIONS_MESSAGES } from '../../../services/operations-messages';

test('housekeeping runs by default, needs authentication, and stops only when explicitly switched off', async () => {
  const previous = { cron: process.env.CRON_SECRET, housekeeping: process.env.HOUSEKEEPING_ENABLED, notifications: process.env.NOTIFICATIONS_ENABLED };
  process.env.CRON_SECRET = 'fixture-secret';
  delete process.env.HOUSEKEEPING_ENABLED;
  process.env.NOTIFICATIONS_ENABLED = 'false';
  let runs = 0;
  let lapses = 0;
  const lapseOptions: unknown[] = [];
  const order: string[] = [];
  const reconciled = { skipped: false, checked: 3, lateCaptureRefunds: 0, unresolved: 1, failed: 0, outOfTime: false };
  const deadlines: number[] = [];
  const renews: (boolean | undefined)[] = [];
  try {
    const route = loadServerModule<{ GET(request: NextRequest): Promise<Response> }>('src/app/api/cron/housekeeping/route.ts', {
      '@/app/services/housekeeping-service': { runHousekeeping: async () => { runs++; order.push('retention'); return { scrubbed: 1 }; } },
      '@/app/services/pending-request-lapse': { lapseStartedPendingRequests: async (_at: Date, options: unknown) => { lapses++; lapseOptions.push(options); order.push('lapse'); return { lapsed: 2, failed: 0 }; } },
      '@/app/services/payment-reconciliation': { reconcilePayments: async () => { order.push('payments'); return reconciled; } },
      '@/app/services/google-calendar-job': { runGoogleCalendarJob: async (run: string, input: { deadline: number; renew?: boolean }) => {
        order.push(`google:${run}`);
        deadlines.push(input.deadline);
        renews.push(input.renew);
        return { skipped: 'disabled' };
      } },
    });
    const request = new NextRequest('https://example.invalid/api/cron/housekeeping', { headers: { authorization: 'Bearer fixture-secret' } });
    assert.equal((await route.GET(new NextRequest(request.url))).status, 401);
    process.env.HOUSEKEEPING_ENABLED = 'false';
    assert.deepEqual(await (await route.GET(request)).json(), { enabled: false });
    assert.equal(runs + lapses, 0, 'no database work before the gates');
    assert.deepEqual(order, [], 'no payment checks (nor Google Calendar) before the gates either');
    // Unset means ON: the privacy notice's retention periods depend on this job.
    delete process.env.HOUSEKEEPING_ENABLED;
    const before = Date.now();
    const response = await route.GET(request);
    assert.equal(response.status, 200);
    // The Google step is told when this function is cut off (start + maxDuration), to skip a pull it could not finish.
    assert.ok(deadlines.length === 1 && deadlines[0] >= before + 300_000 && deadlines[0] <= Date.now() + 300_000);
    // With email sending (and so the notifications cron) still off, unanswered
    // booking requests whose time has passed are closed here; card deposits
    // are reconciled last, on the same wake.
    assert.deepEqual(await response.json(), { scrubbed: 1, requestsLapsed: 2, requestLapseFailed: 0, payments: reconciled, googleCalendar: { skipped: 'disabled' } });
    // The Google Calendar run comes last, so the lapses above reach Google in the same wake.
    assert.deepEqual(order, ['retention', 'lapse', 'payments', 'google:daily']);
    // The watch channel is only renewed near its expiry: replacing it every night is Sync now's job, not this one's.
    assert.deepEqual(renews, [false]);
    assert.equal(runs, 1);
    assert.equal(lapses, 1);
    // Review I-E: only this daily run lapses requests whose deposit was taken
    // (12 hours after their appointment ended), never the notifications cron.
    assert.deepEqual(lapseOptions, [{ takenDeposits: true }]);
  } finally {
    for (const [key, value] of Object.entries({ CRON_SECRET: previous.cron, HOUSEKEEPING_ENABLED: previous.housekeeping, NOTIFICATIONS_ENABLED: previous.notifications })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('a failing booking-request lapse never hides a successful housekeeping run', async (t) => {
  t.mock.method(console, 'error', () => {});
  const previous = { cron: process.env.CRON_SECRET, housekeeping: process.env.HOUSEKEEPING_ENABLED };
  process.env.CRON_SECRET = 'fixture-secret';
  process.env.HOUSEKEEPING_ENABLED = 'true';
  try {
    let reconciled = 0;
    let google = 0;
    const route = loadServerModule<{ GET(request: NextRequest): Promise<Response> }>('src/app/api/cron/housekeeping/route.ts', {
      '@/app/services/housekeeping-service': { runHousekeeping: async () => ({ scrubbed: 0 }) },
      '@/app/services/pending-request-lapse': { lapseStartedPendingRequests: async () => { throw new Error('database unavailable'); } },
      '@/app/services/payment-reconciliation': { reconcilePayments: async () => { reconciled++; throw new Error('database unavailable'); } },
      '@/app/services/google-calendar-job': { runGoogleCalendarJob: async () => { google++; throw new Error('database unavailable'); } },
    });
    const response = await route.GET(new NextRequest('https://example.invalid/api/cron/housekeeping', { headers: { authorization: 'Bearer fixture-secret' } }));
    assert.equal(response.status, 200);
    // A failing lapse does not stop the payment checks or the Google Calendar run, and none fails the run.
    assert.deepEqual(await response.json(), { scrubbed: 0, requestsLapsed: 0, requestLapseFailed: 1, payments: { failed: 1 }, googleCalendar: { error: true } });
    assert.equal(reconciled, 1);
    assert.equal(google, 1);
  } finally {
    for (const [key, value] of Object.entries({ CRON_SECRET: previous.cron, HOUSEKEEPING_ENABLED: previous.housekeeping })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

// ── Google Calendar (task G8 of docs/superpowers/plans/2026-10-16-google-calendar-two-way-sync.md) ──
// End to end through the real job module (services/google-calendar-job.ts),
// with only its I/O replaced.

async function withHousekeepingEnv(run: () => Promise<void>) {
  const previous = { cron: process.env.CRON_SECRET, housekeeping: process.env.HOUSEKEEPING_ENABLED };
  process.env.CRON_SECRET = 'fixture-secret';
  delete process.env.HOUSEKEEPING_ENABLED;
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries({ CRON_SECRET: previous.cron, HOUSEKEEPING_ENABLED: previous.housekeeping })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function housekeepingWithRealJob(options: { enabled: boolean; channelThrows?: boolean }) {
  const order: string[] = [];
  const jobRows: string[] = [];
  const counts = { googleImports: 0 };
  const db = { backgroundJobState: {
    upsert: async ({ where }: { where: { name: string } }) => { jobRows.push(`start:${where.name}`); return {}; },
    update: async ({ where, data }: { where: { name: string }; data: { lastError?: string | null } }) => { jobRows.push(`end:${where.name}:${data.lastError ?? 'ok'}`); return {}; },
  } };
  const counted = <T extends object>(module: T): T => new Proxy(module, { get(target, key) { counts.googleImports++; return target[key as keyof T]; } });
  const job = loadServerModule('src/app/services/google-calendar-job.ts', {
    '@/app/lib/google-calendar-config': { googleCalendarConfig: () => (options.enabled ? { calendarId: 'c', clientEmail: 'e', privateKey: 'k', webhookSecret: 's' } : null) },
    '@/app/lib/prisma': counted({ __esModule: true, default: db }),
    // The calendar change guard (services/google-calendar-guard.ts): the configured calendar is the recorded one.
    './google-calendar-guard': counted({ guardGoogleCalendarChange: async () => 'same' }),
    './google-calendar-channel': counted({
      ensureGoogleWatchChannel: async (input: unknown) => {
        order.push(`channel:${JSON.stringify(input)}`);
        if (options.channelThrows) throw new Error('Google refused the watch request');
        return 'renewed';
      },
      runPullSingleFlight: async (pull: () => Promise<unknown>) => { order.push('single-flight'); await pull(); },
    }),
    './google-calendar-push': counted({ pushGoogleCalendar: async (input: { mode: string }) => { order.push(`push:${input.mode}`); return { written: 0, deleted: 1, unchanged: 9, failed: 0 }; } }),
    './google-calendar-pull': counted({ pullGoogleCalendar: async () => { order.push('pull'); return { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false }; } }),
  });
  const route = loadServerModule<{ GET(request: NextRequest): Promise<Response> }>('src/app/api/cron/housekeeping/route.ts', {
    '@/app/services/housekeeping-service': { runHousekeeping: async () => { order.push('retention'); return { scrubbed: 0 }; } },
    '@/app/services/pending-request-lapse': { lapseStartedPendingRequests: async () => { order.push('lapse'); return { lapsed: 0, failed: 0 }; } },
    '@/app/services/payment-reconciliation': { reconcilePayments: async () => { order.push('payments'); return { skipped: true }; } },
    '@/app/services/google-calendar-job': job,
  });
  const get = () => route.GET(new NextRequest('https://example.invalid/api/cron/housekeeping', { headers: { authorization: 'Bearer fixture-secret' } }));
  return { get, order, jobRows, counts };
}

test('with the Google sync off housekeeping makes no Google call and no extra query', async () => {
  await withHousekeepingEnv(async () => {
    const h = housekeepingWithRealJob({ enabled: false });
    const response = await h.get();
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).googleCalendar, { skipped: 'disabled' });
    assert.deepEqual(h.order, ['retention', 'lapse', 'payments']);
    assert.deepEqual(h.jobRows, []);
    assert.equal(h.counts.googleImports, 0);
  });
});

test('daily Google run after payments: watch channel, the whole window, then the single-flight pull', async () => {
  await withHousekeepingEnv(async () => {
    const h = housekeepingWithRealJob({ enabled: true });
    const response = await h.get();
    assert.equal(response.status, 200);
    assert.deepEqual(h.order, ['retention', 'lapse', 'payments', 'channel:{"renew":false}', 'push:all', 'single-flight', 'pull']);
    assert.deepEqual(h.jobRows, ['start:google-calendar-daily', 'end:google-calendar-daily:ok'], 'the daily run has its own row');
    assert.deepEqual((await response.json()).googleCalendar, {
      ok: true, channel: 'renewed', push: { written: 0, deleted: 1, unchanged: 9, failed: 0 }, pull: { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false },
    });
  });
});

test('a watch channel that cannot be made is recorded in the google-calendar-daily row; the run still pushes, pulls and answers 200', async (t) => {
  t.mock.method(console, 'error', () => {});
  await withHousekeepingEnv(async () => {
    const h = housekeepingWithRealJob({ enabled: true, channelThrows: true });
    assert.equal((await h.get()).status, 200);
    assert.deepEqual(h.order, ['retention', 'lapse', 'payments', 'channel:{"renew":false}', 'push:all', 'single-flight', 'pull']);
    assert.deepEqual(h.jobRows, ['start:google-calendar-daily', `end:google-calendar-daily:${OPERATIONS_MESSAGES.GOOGLE_CHANNEL_FAILED}`]);
  });
});

test('housekeeping has room for the payment checks and the Google push and pull', async () => {
  const route = await import('./route');
  assert.ok(route.maxDuration >= 300);
});
