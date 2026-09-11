import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { loadServerModule } from '../../../../test/load-server-module';

for (const name of ['notifications', 'reminders']) {
  test(`${name}: authentication and disabled flag are checked before database work`, async () => {
    const previous = { secret: process.env.CRON_SECRET, enabled: process.env.NOTIFICATIONS_ENABLED };
    process.env.CRON_SECRET = 'test-cron-secret';
    delete process.env.NOTIFICATIONS_ENABLED;
    let calls = 0;
    try {
      const route = loadServerModule<{ GET: (request: NextRequest) => Promise<Response> }>(`src/app/api/cron/${name}/route.ts`, {
        '@/app/services/notification-cron-service': { runNotificationCron: async () => { calls++; return { failed: 0 }; } },
      });
      assert.equal((await route.GET(new NextRequest('https://example.com'))).status, 401);
      const authorized = new NextRequest('https://example.com', { headers: { authorization: 'Bearer test-cron-secret' } });
      assert.deepEqual(await (await route.GET(authorized)).json(), { enabled: false });
      assert.equal(calls, 0);
      process.env.NOTIFICATIONS_ENABLED = 'true';
      assert.equal((await route.GET(authorized)).status, 200);
      assert.equal(calls, 1);
    } finally {
      if (previous.secret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous.secret;
      if (previous.enabled === undefined) delete process.env.NOTIFICATIONS_ENABLED; else process.env.NOTIFICATIONS_ENABLED = previous.enabled;
    }
  });
}
