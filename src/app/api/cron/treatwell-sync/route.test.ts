import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from './route';

const SECRET = 'test-cron-secret';

function authedRequest(): NextRequest {
  return new NextRequest('https://example.test/api/cron/treatwell-sync', {
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

// The load-bearing test. `syncTreatwellFeeds()` opens with a DB query, which
// wakes Neon's compute and bills CU-hours even when the run is a no-op. If this
// ever returns anything but `skipped`, the kill-switch has drifted below the
// sync call and the cost regression is back.
test('returns without running the sync when TREATWELL_SYNC_ENABLED is not "true"', async () => {
  await withEnv({ CRON_SECRET: SECRET, TREATWELL_SYNC_ENABLED: undefined }, async () => {
    const response = await GET(authedRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, skipped: 'disabled', results: [] });
  });
});

test('treats any value other than "true" as disabled', async () => {
  for (const value of ['false', '1', 'TRUE', 'yes', '']) {
    await withEnv({ CRON_SECRET: SECRET, TREATWELL_SYNC_ENABLED: value }, async () => {
      const body = await (await GET(authedRequest())).json();
      assert.equal(body.skipped, 'disabled', `expected "${value}" to be treated as disabled`);
    });
  }
});

// Auth must stay above the kill-switch: an unauthenticated caller should never
// learn whether the sync is enabled.
test('rejects an unauthenticated request even while disabled', async () => {
  await withEnv({ CRON_SECRET: SECRET, TREATWELL_SYNC_ENABLED: undefined }, async () => {
    const response = await GET(new NextRequest('https://example.test/api/cron/treatwell-sync'));
    assert.equal(response.status, 401);
  });
});

test('fails closed when CRON_SECRET is unset', async () => {
  await withEnv({ CRON_SECRET: undefined, TREATWELL_SYNC_ENABLED: 'true' }, async () => {
    const response = await GET(authedRequest());
    assert.equal(response.status, 500);
  });
});
