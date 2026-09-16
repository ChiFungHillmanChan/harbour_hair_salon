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
  try {
    const route = loadServerModule<{ GET(request: NextRequest): Promise<Response> }>('src/app/api/cron/housekeeping/route.ts', {
      '@/app/services/housekeeping-service': { runHousekeeping: async () => { runs++; return { scrubbed: 1 }; } },
    });
    const request = new NextRequest('https://example.invalid/api/cron/housekeeping', { headers: { authorization: 'Bearer fixture-secret' } });
    assert.equal((await route.GET(new NextRequest(request.url))).status, 401);
    assert.deepEqual(await (await route.GET(request)).json(), { enabled: false });
    assert.equal(runs, 0);
    process.env.HOUSEKEEPING_ENABLED = 'true';
    assert.equal((await route.GET(request)).status, 200);
    assert.equal(runs, 1);
  } finally {
    for (const [key, value] of Object.entries({ CRON_SECRET: previous.cron, HOUSEKEEPING_ENABLED: previous.housekeeping, NOTIFICATIONS_ENABLED: previous.notifications })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
