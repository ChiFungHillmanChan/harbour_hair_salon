import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { loadServerModule } from '../../../../test/load-server-module';

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
  try {
    const route = loadServerModule<{ GET(request: NextRequest): Promise<Response> }>('src/app/api/cron/housekeeping/route.ts', {
      '@/app/services/housekeeping-service': { runHousekeeping: async () => { runs++; order.push('retention'); return { scrubbed: 1 }; } },
      '@/app/services/pending-request-lapse': { lapseStartedPendingRequests: async (_at: Date, options: unknown) => { lapses++; lapseOptions.push(options); order.push('lapse'); return { lapsed: 2, failed: 0 }; } },
      '@/app/services/payment-reconciliation': { reconcilePayments: async () => { order.push('payments'); return reconciled; } },
    });
    const request = new NextRequest('https://example.invalid/api/cron/housekeeping', { headers: { authorization: 'Bearer fixture-secret' } });
    assert.equal((await route.GET(new NextRequest(request.url))).status, 401);
    process.env.HOUSEKEEPING_ENABLED = 'false';
    assert.deepEqual(await (await route.GET(request)).json(), { enabled: false });
    assert.equal(runs + lapses, 0, 'no database work before the gates');
    assert.deepEqual(order, [], 'no payment checks before the gates either');
    // Unset means ON: the privacy notice's retention periods depend on this job.
    delete process.env.HOUSEKEEPING_ENABLED;
    const response = await route.GET(request);
    assert.equal(response.status, 200);
    // With email sending (and so the notifications cron) still off, unanswered
    // booking requests whose time has passed are closed here; card deposits
    // are reconciled last, on the same wake.
    assert.deepEqual(await response.json(), { scrubbed: 1, requestsLapsed: 2, requestLapseFailed: 0, payments: reconciled });
    assert.deepEqual(order, ['retention', 'lapse', 'payments']);
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
    const route = loadServerModule<{ GET(request: NextRequest): Promise<Response> }>('src/app/api/cron/housekeeping/route.ts', {
      '@/app/services/housekeeping-service': { runHousekeeping: async () => ({ scrubbed: 0 }) },
      '@/app/services/pending-request-lapse': { lapseStartedPendingRequests: async () => { throw new Error('database unavailable'); } },
      '@/app/services/payment-reconciliation': { reconcilePayments: async () => { reconciled++; throw new Error('database unavailable'); } },
    });
    const response = await route.GET(new NextRequest('https://example.invalid/api/cron/housekeeping', { headers: { authorization: 'Bearer fixture-secret' } }));
    assert.equal(response.status, 200);
    // A failing lapse does not stop the payment checks, and neither fails the run.
    assert.deepEqual(await response.json(), { scrubbed: 0, requestsLapsed: 0, requestLapseFailed: 1, payments: { failed: 1 } });
    assert.equal(reconciled, 1);
  } finally {
    for (const [key, value] of Object.entries({ CRON_SECRET: previous.cron, HOUSEKEEPING_ENABLED: previous.housekeeping })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
