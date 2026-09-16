import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Secret, TOTP } from 'otpauth';
import { redirect } from 'next/dist/client/components/redirect';
import { loadServerModule } from '../../test/load-server-module';
import { encryptMfaSecret, createRecoveryCodes, hashRecoveryCode } from '../lib/mfa-crypto';

function fixture(t: TestContext, enrolled = false, allowed = true) {
  const prior = process.env.SESSION_SECRET; process.env.SESSION_SECRET = 'fixture-mfa-action-secret-32-characters';
  t.after(() => { if (prior === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = prior; });
  const secret = new Secret({ size: 20 }).base32;
  const recoveryCodes = createRecoveryCodes();
  const user = { id: 'admin-1', email: 'admin@example.invalid', role: 'ADMIN', password: 'password-hash', sessionVersion: 3,
    mfaSecretEncrypted: enrolled ? encryptMfaSecret(secret) : null, mfaEnabledAt: enrolled ? new Date() : null, mfaLastUsedStep: null as number | null,
    mfaRecoveryCodesJson: enrolled ? JSON.stringify(recoveryCodes.map(hashRecoveryCode)) : '[]', mfaPendingSecretEncrypted: null as string | null, mfaPendingExpiresAt: null as Date | null };
  let sessions = 0;
  let audits = 0;
  let attempts = 0;
  const tx = { user: {
    findUnique: async () => ({ ...user }),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (where.sessionVersion !== undefined && where.sessionVersion !== user.sessionVersion) return { count: 0 };
      if (where.mfaEnabledAt === null && user.mfaEnabledAt !== null) return { count: 0 };
      if (typeof where.mfaRecoveryCodesJson === 'string' && where.mfaRecoveryCodesJson !== user.mfaRecoveryCodesJson) return { count: 0 };
      if (where.OR && user.mfaLastUsedStep !== null && user.mfaLastUsedStep >= (where.OR as { mfaLastUsedStep?: { lt: number } }[])[1].mfaLastUsedStep!.lt) return { count: 0 };
      const next = { ...data };
      if (typeof next.sessionVersion === 'object') next.sessionVersion = user.sessionVersion + 1;
      Object.assign(user, next); return { count: 1 };
    },
  }, auditEvent: { count: async () => attempts } };
  let tail = Promise.resolve<unknown>(undefined);
  const db = { ...tx, $transaction: (run: (db: typeof tx) => Promise<unknown>) => {
    const work = tail.then(() => run(tx)); tail = work.catch(() => {}); return work;
  } };
  const actions = loadServerModule<typeof import('./admin-mfa')>('src/app/actions/admin-mfa.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/admin-mfa': { requirePendingAdminMfa: async () => ({ ...user }), clearAdminMfaChallenge: async () => {} },
    '@/app/lib/password': { verifyPassword: async (value: string) => value === 'current-password' },
    '@/app/lib/session': { createSession: async (_id: string, _role: string, _version: number, proof: boolean) => { assert.equal(proof, true); sessions++; } },
    '@/app/lib/audit': { appendAuditEvent: async ({ action }: { action: string }) => { if (action === 'AUTH.MFA_ATTEMPT') attempts++; else audits++; } },
    '@/app/lib/rate-limit': { createRateLimiter: () => ({ check: async () => allowed }) },
    'next/headers': { headers: async () => new Headers() },
    'next/navigation': { redirect },
  });
  const code = (seed = secret) => TOTP.generate({ secret: Secret.fromBase32(seed), algorithm: 'SHA1', digits: 6, period: 30 });
  const form = (values: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(values)) f.set(k, v); return f; };
  return { user, actions, code, form, recoveryCodes, sessions: () => sessions, audits: () => audits, attempts: () => attempts };
}

test('enrollment needs the current password, reuses its pending seed and cannot replace enabled MFA', async (t) => {
  const f = fixture(t);
  const denied = await f.actions.beginMfaEnrollment({}, f.form({ password: 'wrong' }));
  assert.ok(denied.error); assert.equal(f.user.mfaPendingSecretEncrypted, null);
  const first = await f.actions.beginMfaEnrollment({}, f.form({ password: 'current-password' }));
  assert.ok(first.secret);
  const again = await f.actions.beginMfaEnrollment({}, f.form({ password: 'current-password' }));
  assert.equal(again.secret, first.secret);
  const done = await f.actions.finishMfaEnrollment({}, f.form({ code: f.code(first.secret) }));
  assert.equal(done.recoveryCodes?.length, 10);
  assert.equal(f.sessions(), 1);
  assert.equal(f.user.sessionVersion, 4);
  assert.equal(f.user.mfaPendingSecretEncrypted, null);
  assert.equal(f.user.mfaRecoveryCodesJson.includes(done.recoveryCodes![0]), false);
  const overwrite = await f.actions.beginMfaEnrollment({}, f.form({ password: 'current-password' }));
  assert.ok(overwrite.error);
});

test('the same TOTP or recovery code can create at most one full administrator session', async (t) => {
  const f = fixture(t, true);
  const submit = async (code: string) => {
    try { return await f.actions.verifyAdminMfa({}, f.form({ code })); }
    catch (error) { if (error instanceof Error && 'digest' in error) return { success: true }; throw error; }
  };
  const otp = f.code();
  const results = await Promise.all([submit(otp), submit(otp)]);
  assert.equal(results.filter((r) => 'success' in r).length, 1);
  assert.equal(f.sessions(), 1);
  const recovery = await Promise.all([submit(f.recoveryCodes[0]), submit(f.recoveryCodes[0])]);
  assert.equal(recovery.filter((r) => 'success' in r).length, 1);
  assert.equal(f.sessions(), 2);
  assert.equal(f.audits(), 2);
});

test('rate-limited MFA attempts cannot start enrollment or issue any sessions', async (t) => {
  const f = fixture(t, false, false);
  assert.ok((await f.actions.beginMfaEnrollment({}, f.form({ password: 'current-password' }))).error);
  assert.ok((await f.actions.finishMfaEnrollment({}, f.form({ code: '000000' }))).error);
  assert.ok((await f.actions.verifyAdminMfa({}, f.form({ code: '000000' }))).error);
  assert.equal(f.sessions(), 0); assert.equal(f.user.mfaPendingSecretEncrypted, null);
});

test('concurrent MFA attempts share a durable account budget even when the IP limiter allows every request', async (t) => {
  const f = fixture(t, true);
  const results = await Promise.all(Array.from({ length: 12 }, () => f.actions.verifyAdminMfa({}, f.form({ code: 'not-a-valid-factor' }))));
  assert.equal(f.attempts(), 8);
  assert.equal(results.filter((result) => result.error?.startsWith('Too many attempts')).length, 4);
  assert.ok((await f.actions.verifyAdminMfa({}, f.form({ code: f.recoveryCodes[0] }))).error?.startsWith('Too many attempts'));
  assert.equal(f.sessions(), 0);
  assert.equal(JSON.parse(f.user.mfaRecoveryCodesJson).length, 10);
});
