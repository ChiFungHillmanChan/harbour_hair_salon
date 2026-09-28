import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOperationsBookingReadiness, checkOperationsRuntimeReadiness, runOperationsDiagnostics } from './operations-readiness';

const now = new Date('2026-09-11T10:00:00Z');
const env = {
  EMAIL_FROM: 'Harbour Hair <bookings@example.com>', SALON_NOTIFY_EMAIL: 'salon@example.com',
  RESEND_API_KEY: 'private-resend-token', CRON_SECRET: 'private-cron-token', NOTIFICATIONS_ENABLED: 'true',
  UPSTASH_REDIS_REST_URL: 'https://salon.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'private-redis-token',
};

function fixture() {
  let state: Record<string, unknown> | null = null;
  const db = {
    $queryRaw: async () => [{ result: 1 }],
    backgroundJobState: {
      upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        state = state ? { ...state, ...update } : create;
        return state;
      },
      findUnique: async () => state,
    },
  };
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    if (String(input).startsWith('https://api.resend.com/domains')) {
      return Response.json({ data: [{ name: 'example.com', status: 'verified', capabilities: { sending: 'enabled' } }], has_more: false });
    }
    assert.equal(String(input), 'https://salon.upstash.io/ping');
    return Response.json({ result: 'PONG' });
  };
  return { db, fetchImpl, getState: () => state, setState: (value: Record<string, unknown>) => { state = value; } };
}

test('verified read-only checks allow booking and persist no credentials', async () => {
  const f = fixture();
  const checks = await runOperationsDiagnostics({ db: f.db as never, env, now, fetchImpl: f.fetchImpl });
  assert.ok(checks.every((check) => check.status === 'pass'));
  assert.ok(checks.every((check) => typeof check.code === 'string'), 'every check carries a translatable code');
  assert.deepEqual(await checkOperationsBookingReadiness(f.db as never, now, env), { ready: true, blockers: [], issues: [] });
  const saved = JSON.stringify(f.getState());
  for (const secret of ['private-resend-token', 'private-cron-token', 'private-redis-token', 'salon@example.com']) {
    assert.ok(!saved.includes(secret));
  }
});

test('sending-only Resend permission is unknown and blocks enabling without exposing response body', async () => {
  const f = fixture();
  const checks = await runOperationsDiagnostics({ db: f.db as never, env, now,
    fetchImpl: async (input, init) => String(input).includes('resend.com')
      ? new Response('secret response body', { status: 403 }) : f.fetchImpl(input, init),
  });
  assert.equal(checks.find((check) => check.id === 'resend')?.status, 'unknown');
  assert.equal(checks.find((check) => check.id === 'resend')?.code, 'resend.forbidden');
  assert.equal((await checkOperationsBookingReadiness(f.db as never, now, env)).ready, false);
  assert.ok(!JSON.stringify(checks).includes('secret response body'));
});

test('wrong sender domain, network failure and absent settings cannot produce a passing report', async () => {
  const f = fixture();
  const checks = await runOperationsDiagnostics({ db: f.db as never, env: { ...env, EMAIL_FROM: 'sender@other.example' }, now,
    fetchImpl: async (input, init) => String(input).includes('upstash.io')
      ? Promise.reject(new Error('private-redis-token secret URL')) : f.fetchImpl(input, init),
  });
  assert.equal(checks.find((check) => check.id === 'resend')?.status, 'fail');
  assert.equal(checks.find((check) => check.id === 'redis')?.status, 'fail');
  assert.ok(!JSON.stringify(checks).includes('private-redis-token'));
});

test('a report expires at 24 hours and malformed or incomplete evidence cannot pass', async () => {
  const f = fixture();
  await runOperationsDiagnostics({ db: f.db as never, env, now, fetchImpl: f.fetchImpl });
  assert.equal((await checkOperationsBookingReadiness(f.db as never, new Date('2026-09-12T09:59:59Z'), env)).ready, true);
  const expired = await checkOperationsBookingReadiness(f.db as never, new Date('2026-09-12T10:00:00Z'), env);
  assert.equal(expired.ready, false);
  // Each English blocker has a code the admin page can word in either language.
  assert.deepEqual(expired.issues, [{ code: 'blockers.reportRequired' }]);
  assert.equal(expired.blockers.length, expired.issues.length);
  for (const json of ['[]', 'invalid', '[{"id":"resend","status":"pass"}]']) {
    f.setState({ lastSucceededAt: now, lastStartedAt: now, lastResultJson: json });
    assert.equal((await checkOperationsBookingReadiness(f.db as never, now, env)).ready, false);
  }
});

test('current runtime prerequisites and later failed diagnostics override a prior pass', async () => {
  const f = fixture();
  await runOperationsDiagnostics({ db: f.db as never, env, now, fetchImpl: f.fetchImpl });
  for (const override of [
    { NOTIFICATIONS_ENABLED: 'false' }, { CRON_SECRET: '' }, { SALON_NOTIFY_EMAIL: '' },
    { EMAIL_FROM: 'Sender <onboarding@resend.dev>' }, { UPSTASH_REDIS_REST_TOKEN: '' },
  ]) {
    assert.equal((await checkOperationsBookingReadiness(f.db as never, now, { ...env, ...override })).ready, false);
  }
  f.setState({ ...f.getState(), lastFailedAt: new Date(now.getTime() + 1000) });
  assert.equal((await checkOperationsBookingReadiness(f.db as never, new Date(now.getTime() + 2000), env)).ready, false);
});

test('unchanged passing runtime evidence remains usable after 24 hours, but changed configuration closes booking', async () => {
  const f = fixture();
  await runOperationsDiagnostics({ db: f.db as never, env, now, fetchImpl: f.fetchImpl });
  const later = new Date('2026-09-20T10:00:00Z');
  assert.equal((await checkOperationsRuntimeReadiness(f.db as never, later, env)).ready, true);
  assert.equal((await checkOperationsRuntimeReadiness(f.db as never, later, { ...env, EMAIL_FROM: 'bookings@unverified.example' })).ready, false);
  assert.equal((await checkOperationsRuntimeReadiness(f.db as never, later, { ...env, CRON_SECRET: '' })).ready, false);
});

test('a redeploy does not expire a passing report, but the database it attests to still does', async () => {
  // `VERCEL_DEPLOYMENT_ID` changes on every Vercel deployment and is readable at
  // runtime, so including it in the configuration fingerprint made a passing
  // Operations report expire on every release. Because that comparison runs on
  // the live booking path via `assertOnlineBookingReady`, it silently closed
  // online booking after each deploy until an admin re-ran diagnostics by hand.
  const f = fixture();
  await runOperationsDiagnostics({ db: f.db as never, env: { ...env, VERCEL_DEPLOYMENT_ID: 'dpl_before' }, now, fetchImpl: f.fetchImpl });
  for (const deployment of ['dpl_after', '', undefined]) {
    assert.equal(
      (await checkOperationsRuntimeReadiness(f.db as never, now, { ...env, VERCEL_DEPLOYMENT_ID: deployment })).ready,
      true,
      `deployment id ${String(deployment)} must not invalidate the report`,
    );
  }
  // The fingerprint must still react to configuration that genuinely changes
  // what was attested to — otherwise this test would pass on a no-op check.
  for (const override of [{ POSTGRES_URL: 'postgres://elsewhere/db' }, { DATABASE_URL: 'postgres://elsewhere/db' }]) {
    assert.equal((await checkOperationsRuntimeReadiness(f.db as never, now, { ...env, ...override })).ready, false);
  }
});
