import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import * as passwordModule from '../lib/password';
import { accountRateLimitKey, createRateLimiter, EMAIL_SEND_DAILY_POLICY, type RateLimiter } from '../lib/rate-limit';
import { translator } from '../../i18n/messages';

// Registration, verification resends and password-reset requests each send an
// email. The Resend plan's small daily allowance (100 a day on the free plan)
// is shared with booking mail, so one client must not be able to spend it.

const auth = translator('en-GB', 'auth');
const DAILY_LIMIT = { status: 'error', message: auth('errors.EMAIL_DAILY_LIMIT') };

const allow: RateLimiter = { check: async () => true, backend: () => 'memory' };
const refuse: RateLimiter = { check: async () => false, backend: () => 'memory' };

/** The three mail-sending forms, wired to one client address and one shared daily limiter. */
function mailForms(daily: RateLimiter, options: { ip?: () => string } = {}) {
  const sent: string[] = [];
  const lookups: string[] = [];
  const created: string[] = [];
  let hashes = 0;
  let accountChecks = 0;
  let resendAccount = 0;
  const headers = async () => new Headers({ 'x-forwarded-for': options.ip?.() ?? '203.0.113.7' });

  const { register } = loadServerModule<typeof import('./auth')>('src/app/actions/auth.ts', {
    '@/app/lib/prisma': { user: {
      findUnique: async ({ where }: { where: { email: string } }) => { lookups.push(where.email); return null; },
      create: async ({ data }: { data: { email: string; name: string } }) => { created.push(data.email); return { ...data, id: `user-${created.length}`, role: 'USER', sessionVersion: 0 }; },
    } },
    '@/app/lib/password': { ...passwordModule, hashPassword: async () => { hashes++; return 'hash'; } },
    '@/app/lib/session': { createSession: async () => {} },
    '@/app/lib/audit': {},
    'next/headers': { headers },
    'next/server': { after: (callback: () => unknown) => callback() },
    'next/navigation': { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    '@/app/lib/rate-limit': { registerLimiter: allow, emailSendDailyLimiter: daily },
    '@/app/services/email-service': { sendEmailVerification: async (user: { email: string }) => { sent.push(`verify:${user.email}`); } },
  });

  const reset = loadServerModule<typeof import('./password-reset')>('src/app/actions/password-reset.ts', {
    '@/app/lib/prisma': {
      user: { findUnique: async ({ where }: { where: { email: string } }) => { lookups.push(where.email); return { id: 'user-reset', email: where.email }; } },
      passwordResetToken: { deleteMany: async () => ({ count: 0 }), create: async () => ({}) },
      $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    },
    'next/headers': { headers },
    '@/app/lib/rate-limit': {
      passwordResetLimiter: allow,
      passwordResetAccountLimiter: { check: async () => { accountChecks++; return true; }, backend: () => 'memory' },
      accountRateLimitKey,
      emailSendDailyLimiter: daily,
    },
    '@/app/services/email-service': { sendPasswordReset: async (user: { email: string }) => { sent.push(`reset:${user.email}`); } },
  });

  const verification = loadServerModule<typeof import('./email-verification')>('src/app/actions/email-verification.ts', {
    // A different unconfirmed account each time, so only per-client limits can apply.
    '@/app/lib/session': { verifySession: async () => ({ userId: `account-${++resendAccount}`, role: 'USER' }) },
    '@/app/lib/prisma': { user: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, email: `${where.id}@example.invalid`, name: null, emailVerifiedAt: null, oauthAccounts: [] }) } },
    'next/headers': { headers },
    'next/navigation': { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    '@/app/lib/audit': {},
    // The action's own policies, memory-backed and real.
    '@/app/lib/rate-limit': { createRateLimiter: (policy: Parameters<typeof createRateLimiter>[0]) => createRateLimiter(policy, { redisLimiter: null }), emailSendDailyLimiter: daily },
    '@/app/services/email-service': { sendEmailVerification: async (user: { email: string }) => { sent.push(`verify:${user.email}`); } },
  });

  let registrations = 0;
  const registerOnce = async () => {
    const form = new FormData();
    form.set('email', `new-${++registrations}@example.invalid`); form.set('name', 'New Customer'); form.set('password', 'a-good-password');
    try {
      return await register(undefined, form);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('redirect:')) return { status: 'registered' as const };
      throw error;
    }
  };
  const resetOnce = (email = 'customer@example.invalid') => {
    const form = new FormData();
    form.set('email', email);
    return reset.requestPasswordReset({ status: 'idle' }, form);
  };
  const resendOnce = () => verification.resendVerificationEmail();
  return { registerOnce, resetOnce, resendOnce, sent, lookups, created, hashes: () => hashes, accountChecks: () => accountChecks };
}

test('the daily email budget is 20 per client address per 24 hours', () => {
  assert.deepEqual(EMAIL_SEND_DAILY_POLICY, { prefix: 'rl:email-ip-day', limit: 20, windowSeconds: 24 * 60 * 60 });
});

test('one client\'s registrations, verification resends and reset requests share a single daily budget', async () => {
  let ip = '203.0.113.7';
  const daily = createRateLimiter(EMAIL_SEND_DAILY_POLICY, { redisLimiter: null });
  const f = mailForms(daily, { ip: () => ip });

  for (let i = 0; i < 4; i++) {
    // Four of each per hour stay inside the short per-client windows.
    assert.deepEqual(await f.registerOnce(), { status: 'registered' });
    assert.deepEqual(await f.resetOnce(`customer-${i}@example.invalid`), { status: 'sent' });
    assert.deepEqual(await f.resendOnce(), { status: 'sent' });
  }
  // Twelve sent; the next eight use up the day whichever form asks.
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(await f.registerOnce(), { status: 'registered' });
    assert.deepEqual(await f.resetOnce(`later-${i}@example.invalid`), { status: 'sent' });
  }
  assert.equal(f.sent.length, 20);

  assert.deepEqual(await f.registerOnce(), { error: auth('errors.EMAIL_DAILY_LIMIT') });
  assert.deepEqual(await f.resetOnce('another@example.invalid'), DAILY_LIMIT);
  assert.equal(f.sent.length, 20, 'nothing more is sent from this client today');
  assert.equal(f.created.length, 8, 'a refused registration creates no account');

  // A different client is unaffected.
  ip = '198.51.100.20';
  assert.deepEqual(await f.registerOnce(), { status: 'registered' });
  assert.equal(f.sent.length, 21);
});

test('verification resends are limited per client address, not only per account', async () => {
  let ip = '203.0.113.7';
  const f = mailForms(createRateLimiter(EMAIL_SEND_DAILY_POLICY, { redisLimiter: null }), { ip: () => ip });
  // Every request is a different account, so the per-account bucket never fills.
  for (let i = 0; i < 5; i++) assert.deepEqual(await f.resendOnce(), { status: 'sent' });
  assert.deepEqual(await f.resendOnce(), { status: 'error', message: auth('verifyEmail.RATE_LIMITED') });
  assert.equal(f.sent.length, 5);

  ip = '198.51.100.20';
  assert.deepEqual(await f.resendOnce(), { status: 'sent' });
});

test('a spent daily budget stops a resend before anything is sent', async () => {
  const f = mailForms(refuse);
  assert.deepEqual(await f.resendOnce(), DAILY_LIMIT);
  assert.deepEqual(f.sent, []);
});

test('a spent daily budget refuses registration before an account or a password hash is made', async () => {
  const f = mailForms(refuse);
  assert.deepEqual(await f.registerOnce(), { error: auth('errors.EMAIL_DAILY_LIMIT') });
  assert.deepEqual(f.created, []);
  assert.equal(f.hashes(), 0);
  assert.deepEqual(f.sent, []);
});

test('a spent daily budget refuses reset requests the same way for every address, before any lookup', async () => {
  const f = mailForms(refuse);
  assert.deepEqual(await f.resetOnce('customer@example.invalid'), DAILY_LIMIT);
  assert.deepEqual(await f.resetOnce('nobody@example.invalid'), DAILY_LIMIT);
  assert.deepEqual(f.lookups, [], 'the answer cannot depend on whether an account exists');
  assert.equal(f.accountChecks(), 0, 'a client past its daily budget cannot spend other accounts\' reset allowance');
  assert.deepEqual(f.sent, []);
});
