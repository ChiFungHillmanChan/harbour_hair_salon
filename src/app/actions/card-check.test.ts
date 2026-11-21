import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

type Options = { userId?: string; revoked?: boolean; allowed?: boolean; auditFails?: boolean };

function fixture(options: Options = {}) {
  const calls = { audits: [] as Record<string, unknown>[], limiter: [] as string[], current: 0, logs: [] as unknown[][] };
  const actions = loadServerModule<typeof import('./card-check')>('src/app/actions/card-check.ts', {
    'next/headers': { headers: async () => new Headers({ 'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) Chrome/157.0.0.0 Mobile Safari/537.36' }) },
    '@/app/lib/audit': {
      appendAuditEvent: async (event: Record<string, unknown>) => {
        if (options.auditFails) throw new Error("Can't reach database server");
        calls.audits.push(event);
        return { id: 'audit-1' };
      },
    },
    '@/app/lib/rate-limit': { cardCheckReportLimiter: { check: async (key: string) => { calls.limiter.push(key); return options.allowed ?? true; } } },
    '@/app/lib/session': {
      getSession: async () => (options.userId ? { userId: options.userId } : null),
      isSessionCurrent: async () => { calls.current++; return !options.revoked; },
    },
  });
  return { actions, calls };
}

const REFUSED = { kind: 'TOKENIZE_REFUSED', environment: 'production', status: 'Error', errorTypes: 'UNEXPECTED_ERROR', detail: 'Verification failed' };

test('a signed-in customer’s card step failure becomes one log line and one audit event, with no personal data', async (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  const { actions, calls } = fixture({ userId: 'user-1' });
  assert.equal(await actions.reportCardCheckFailure(REFUSED), undefined, 'it never answers anything');
  assert.deepEqual(calls.limiter, ['user:user-1']);
  assert.equal(calls.audits.length, 1);
  const audit = calls.audits[0];
  assert.deepEqual([audit.action, audit.actorUserId, audit.targetType, audit.targetId], ['BOOKING.CARD_CHECK_FAILED', 'user-1', 'User', 'user-1']);
  const metadata = audit.metadata as Record<string, unknown>;
  assert.deepEqual([metadata.kind, metadata.environment, metadata.status, metadata.errorTypes, metadata.detail], ['TOKENIZE_REFUSED', 'production', 'Error', 'UNEXPECTED_ERROR', 'Verification failed']);
  assert.match(String(metadata.browser), /Chrome\/157/);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(warn.mock.calls[0].arguments[0], '[card-check] booking card step failed');
});

test('the server scrubs again: a crafted report cannot log card digits', async (t) => {
  t.mock.method(console, 'warn', () => undefined);
  const { actions, calls } = fixture({ userId: 'user-1' });
  await actions.reportCardCheckFailure({ kind: 'TOKENIZE_THREW', detail: 'number 4111 1111 1111 1111' });
  assert.equal((calls.audits[0].metadata as Record<string, unknown>).detail, 'number #');
});

test('junk, unknown kinds, extra fields and oversized text are dropped before any lookup', async () => {
  const { actions, calls } = fixture({ userId: 'user-1' });
  for (const junk of [null, 'TOKENIZE_REFUSED', { kind: 'SOMETHING_ELSE' }, { ...REFUSED, cardNumber: '4111' }, { ...REFUSED, detail: 'x'.repeat(201) }, { ...REFUSED, environment: 'staging' }]) {
    await actions.reportCardCheckFailure(junk);
  }
  assert.deepEqual([calls.limiter, calls.audits, calls.current], [[], [], 0]);
});

test('signed out, over budget or a revoked session: nothing is recorded', async () => {
  for (const options of [{}, { userId: 'user-1', allowed: false }, { userId: 'user-1', revoked: true }] as Options[]) {
    const { actions, calls } = fixture(options);
    await actions.reportCardCheckFailure(REFUSED);
    assert.deepEqual(calls.audits, [], JSON.stringify(options));
  }
  const signedOut = fixture();
  await signedOut.actions.reportCardCheckFailure(REFUSED);
  assert.deepEqual(signedOut.calls.limiter, [], 'a signed-out caller spends no budget');
});

test('a report that cannot be written never throws back at the booking page', async (t) => {
  t.mock.method(console, 'warn', () => undefined);
  const error = t.mock.method(console, 'error', () => undefined);
  const { actions } = fixture({ userId: 'user-1', auditFails: true });
  await assert.doesNotReject(actions.reportCardCheckFailure(REFUSED));
  assert.equal(error.mock.callCount(), 1);
});
