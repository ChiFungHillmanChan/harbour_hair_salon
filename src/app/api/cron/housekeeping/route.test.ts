import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { loadServerModule } from '../../../../test/load-server-module';

test('housekeeping requires its own enable flag and authentication, independent of sending email', async () => {
  const previous = { cron: process.env.CRON_SECRET, housekeeping: process.env.HOUSEKEEPING_ENABLED, notifications: process.env.NOTIFICATIONS_ENABLED };
  process.env.CRON_SECRET = 'fixture-secret';
  delete process.env.HOUSEKEEPING_ENABLED;
  process.env.NOTIFICATIONS_ENABLED = 'false';
  let runs = 0;
  let lapses = 0;
  try {
    const route = loadServerModule<{ GET(request: NextRequest): Promise<Response> }>('src/app/api/cron/housekeeping/route.ts', {
      '@/app/services/housekeeping-service': { runHousekeeping: async () => { runs++; return { scrubbed: 1 }; } },
      '@/app/services/pending-request-lapse': { lapseStartedPendingRequests: async () => { lapses++; return { lapsed: 2, failed: 0 }; } },
    });
    const request = new NextRequest('https://example.invalid/api/cron/housekeeping', { headers: { authorization: 'Bearer fixture-secret' } });
    assert.equal((await route.GET(new NextRequest(request.url))).status, 401);
    assert.deepEqual(await (await route.GET(request)).json(), { enabled: false });
    assert.equal(runs + lapses, 0, 'no database work before the gates');
    process.env.HOUSEKEEPING_ENABLED = 'true';
    const response = await route.GET(request);
    assert.equal(response.status, 200);
    // With email sending (and so the notifications cron) still off, unanswered
    // booking requests whose time has passed are closed here.
    assert.deepEqual(await response.json(), { scrubbed: 1, requestsLapsed: 2, requestLapseFailed: 0 });
    assert.equal(runs, 1);
    assert.equal(lapses, 1);
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
    const route = loadServerModule<{ GET(request: NextRequest): Promise<Response> }>('src/app/api/cron/housekeeping/route.ts', {
      '@/app/services/housekeeping-service': { runHousekeeping: async () => ({ scrubbed: 0 }) },
      '@/app/services/pending-request-lapse': { lapseStartedPendingRequests: async () => { throw new Error('database unavailable'); } },
    });
    const response = await route.GET(new NextRequest('https://example.invalid/api/cron/housekeeping', { headers: { authorization: 'Bearer fixture-secret' } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { scrubbed: 0, requestsLapsed: 0, requestLapseFailed: 1 });
  } finally {
    for (const [key, value] of Object.entries({ CRON_SECRET: previous.cron, HOUSEKEEPING_ENABLED: previous.housekeeping })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
