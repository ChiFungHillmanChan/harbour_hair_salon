import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { fitsBcryptLimit } from '../lib/password';
import { accountRateLimitKey, createRateLimiter } from '../lib/rate-limit';
import { translator } from '../../i18n/messages';

const auth = translator('en-GB', 'auth');

type Token = { id: string; tokenHash: string; userId: string; expiresAt: Date; usedAt: Date | null };

/** One in-memory account shared by the customer reset flow and the admin screen. */
function accountFixture() {
  const user = { id: 'admin-target', email: 'admin@example.invalid', name: 'Admin', role: 'ADMIN', password: 'hash:original', sessionVersion: 1 };
  const tokens: Token[] = [];
  const mailed: string[] = [];
  const matches = (token: Token, where: { id?: string; userId?: string; usedAt?: null; expiresAt?: { gt: Date } }) =>
    (where.id === undefined || token.id === where.id) &&
    (where.userId === undefined || token.userId === where.userId) &&
    (where.usedAt === undefined || token.usedAt === null) &&
    (where.expiresAt === undefined || token.expiresAt > where.expiresAt.gt);
  const tx = {
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
        (where.id === user.id || where.email === user.email) ? { ...user } : null,
      update: async ({ data }: { data: { password: string; sessionVersion: { increment: number } } }) => {
        user.password = data.password;
        user.sessionVersion += data.sessionVersion.increment;
        return { ...user };
      },
    },
    passwordResetToken: {
      create: async ({ data }: { data: Omit<Token, 'id' | 'usedAt'> }) => { tokens.push({ ...data, id: `token-${tokens.length + 1}`, usedAt: null }); },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => tokens.find((token) => token.tokenHash === where.tokenHash) ?? null,
      updateMany: async ({ where, data }: { where: { id: string; usedAt: null; expiresAt: { gt: Date } }; data: { usedAt: Date } }) => {
        const hit = tokens.filter((token) => matches(token, where));
        for (const token of hit) token.usedAt = data.usedAt;
        return { count: hit.length };
      },
      deleteMany: async ({ where }: { where: { userId: string; usedAt: null } }) => {
        const keep = tokens.filter((token) => !matches(token, where));
        const count = tokens.length - keep.length;
        tokens.splice(0, tokens.length, ...keep);
        return { count };
      },
    },
  };
  const db = {
    ...tx,
    $transaction: async (input: ((client: typeof tx) => Promise<unknown>) | Promise<unknown>[]) =>
      Array.isArray(input) ? Promise.all(input) : input(tx),
  };
  const password = { fitsBcryptLimit, hashPassword: async (value: string) => `hash:${value}` };
  const reset = loadServerModule<typeof import('./password-reset')>('src/app/actions/password-reset.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/password': password,
    '@/app/lib/audit': { appendAuditEvent: async () => {} },
    'next/headers': { headers: async () => new Headers() },
    '@/app/lib/rate-limit': {
      passwordResetLimiter: { check: async () => true },
      passwordResetAccountLimiter: { check: async () => true },
      accountRateLimitKey,
    },
    '@/app/services/email-service': { sendPasswordReset: async (_user: unknown, token: string) => { mailed.push(token); } },
  });
  const admin = loadServerModule<typeof import('./admin')>('src/app/actions/admin.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/password': password,
    '@/app/lib/session': { verifySession: async () => ({ userId: 'acting-admin', role: 'ADMIN' }) },
    '@/app/lib/audit': { appendAuditEvent: async () => {} },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    'next/cache': { revalidatePath: () => {} },
    '@/app/actions/admin-services': {},
    '@/app/services/treatwell-api': {},
    '@/app/services/notification-outbox-service': {},
    '@/app/services/integration-readiness': {},
    '@/app/services/booking-service': {},
  });
  const requestLink = () => {
    const form = new FormData();
    form.set('email', user.email);
    return reset.requestPasswordReset({ status: 'idle' }, form);
  };
  const redeem = (token: string, newPassword: string) => {
    const form = new FormData();
    form.set('token', token); form.set('password', newPassword); form.set('confirmPassword', newPassword);
    return reset.resetPassword({ status: 'idle' }, form);
  };
  return { user, tokens, mailed, requestLink, redeem, admin };
}

test('an administrator setting a password retires every reset link issued before it', async () => {
  const f = accountFixture();
  assert.equal((await f.requestLink()).status, 'sent');
  const leakedLink = f.mailed[0];

  assert.deepEqual(await f.admin.resetUserPassword('admin-target', 'recovered-password'), { success: true });
  assert.equal(f.tokens.length, 0);

  // Whoever holds the old link can no longer undo the recovery.
  const result = await f.redeem(leakedLink, 'attacker-password');
  assert.equal(result.status, 'error');
  assert.equal(f.user.password, 'hash:recovered-password');

  // A link requested afterwards still works normally.
  await f.requestLink();
  assert.equal((await f.redeem(f.mailed[1], 'owner-choice-1')).status, 'success');
  assert.equal(f.user.password, 'hash:owner-choice-1');
});

test('new passwords over bcrypt\'s 72 bytes are refused everywhere a password is set', async () => {
  const f = accountFixture();
  const tooLong = 'a'.repeat(73);
  const tooLongChinese = '髮'.repeat(25); // 75 bytes

  assert.deepEqual(await f.admin.resetUserPassword('admin-target', tooLong), { error: translator('en-GB', 'adminOps')('users.errors.PASSWORD_TOO_LONG') });
  assert.equal(f.user.password, 'hash:original');

  await f.requestLink();
  const result = await f.redeem(f.mailed[0], tooLongChinese);
  assert.deepEqual(result, { status: 'error', message: auth('errors.PASSWORD_TOO_LONG') });
  assert.equal(f.user.password, 'hash:original');
  assert.equal(f.tokens[0].usedAt, null, 'a refused password does not spend the link');

  // Exactly 72 bytes is still accepted.
  assert.equal((await f.redeem(f.mailed[0], '髮'.repeat(24))).status, 'success');

  let created = 0;
  const { register } = loadServerModule<typeof import('./auth')>('src/app/actions/auth.ts', {
    '@/app/lib/prisma': { user: { findUnique: async () => null, create: async () => { created++; return { id: 'new' }; } } },
    '@/app/lib/password': { fitsBcryptLimit, hashPassword: async () => 'hash' },
    '@/app/lib/session': { createSession: async () => {} },
    '@/app/lib/audit': {},
    'next/headers': { headers: async () => new Headers() },
    'next/navigation': { redirect: () => { throw new Error('Unexpected sign-in'); } },
    '@/app/lib/rate-limit': { registerLimiter: { check: async () => true } },
  });
  const form = new FormData();
  form.set('email', 'new@example.invalid'); form.set('name', 'New Customer'); form.set('password', tooLong);
  assert.deepEqual(await register(undefined, form), { error: auth('errors.PASSWORD_TOO_LONG') });
  assert.equal(created, 0);
});

function loginFixture() {
  let verifications = 0;
  // A fresh, memory-backed account bucket with the production policy.
  const loginAccountLimiter = createRateLimiter({ prefix: 'test:login-acct', limit: 10, windowSeconds: 15 * 60 }, { redisLimiter: null });
  let ip = 0;
  const { login } = loadServerModule<typeof import('./auth')>('src/app/actions/auth.ts', {
    '@/app/lib/prisma': { user: { findUnique: async ({ where }: { where: { email: string } }) => ({ id: where.email, password: 'hash', role: 'ADMIN', sessionVersion: 0 }) } },
    '@/app/lib/password': { fitsBcryptLimit, verifyPassword: async () => { verifications++; return false; } },
    '@/app/lib/session': { createSession: async () => {} },
    '@/app/lib/audit': { appendAuditEvent: async () => {} },
    // Every attempt comes from a new address, so the per-IP bucket never fires.
    'next/headers': { headers: async () => new Headers({ 'x-forwarded-for': `203.0.113.${++ip}` }) },
    'next/navigation': { redirect: (path: string) => { throw new Error(path); } },
    '@/app/lib/rate-limit': { loginLimiter: { check: async () => true }, loginAccountLimiter, accountRateLimitKey },
  });
  const attempt = (email: string) => {
    const form = new FormData(); form.set('email', email); form.set('password', 'guess');
    return login(undefined, form);
  };
  return { attempt, verifications: () => verifications };
}

test('password guesses spread across many IP addresses still hit a per-account limit', async () => {
  const f = loginFixture();
  for (let i = 0; i < 10; i++) {
    assert.deepEqual(await f.attempt('admin@example.invalid'), { error: auth('errors.INCORRECT_CREDENTIALS') });
  }
  // A different spelling of the same address does not open a second bucket.
  assert.deepEqual(await f.attempt('ADMIN@Example.invalid'), { error: auth('errors.LOGIN_RATE_LIMITED') });
  assert.equal(f.verifications(), 10, 'the eleventh guess is never checked against the password');
  // Other accounts are unaffected.
  assert.deepEqual(await f.attempt('someone-else@example.invalid'), { error: auth('errors.INCORRECT_CREDENTIALS') });
});

test('reset requests from many IP addresses cannot flood one mailbox', async () => {
  const f = accountFixture();
  const accountLimiter = createRateLimiter({ prefix: 'test:pwreset-acct', limit: 3, windowSeconds: 60 * 60 }, { redisLimiter: null });
  const reset = loadServerModule<typeof import('./password-reset')>('src/app/actions/password-reset.ts', {
    '@/app/lib/prisma': {
      user: { findUnique: async () => ({ id: f.user.id, email: f.user.email, name: f.user.name }) },
      passwordResetToken: { deleteMany: async () => ({ count: 0 }), create: async () => ({}) },
      $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    },
    'next/headers': { headers: async () => new Headers({ 'x-forwarded-for': `198.51.100.${f.mailed.length + 1}` }) },
    '@/app/lib/rate-limit': { passwordResetLimiter: { check: async () => true }, passwordResetAccountLimiter: accountLimiter, accountRateLimitKey },
    '@/app/services/email-service': { sendPasswordReset: async (_user: unknown, token: string) => { f.mailed.push(token); } },
  });
  const form = new FormData();
  form.set('email', f.user.email);
  for (let i = 0; i < 5; i++) {
    // The answer never changes, so it reveals neither the account nor the limit.
    assert.deepEqual(await reset.requestPasswordReset({ status: 'idle' }, form), { status: 'sent' });
  }
  assert.equal(f.mailed.length, 3);
});
