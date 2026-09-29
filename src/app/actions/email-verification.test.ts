import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { loadServerModule } from '../../test/load-server-module';
import * as passwordModule from '../lib/password';
import {
  createEmailVerificationToken,
  hasVerifiedEmail,
  readEmailVerificationToken,
} from '../lib/email-verification';
import { translator } from '../../i18n/messages';

function withSecret(t: TestContext) {
  const prior = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'email-verification-test-secret-32-chars';
  t.after(() => { if (prior === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = prior; });
}

const customer = { id: 'user-1', email: 'client@example.invalid', name: 'Client' };

test('a verification link names its account, address and language, and nothing else passes', async (t) => {
  withSecret(t);
  const token = await createEmailVerificationToken({ id: 'user-1', email: ' Client@Example.Invalid ' }, 'zh-HK');
  assert.deepEqual(await readEmailVerificationToken(token), { userId: 'user-1', email: 'client@example.invalid', locale: 'zh-HK' });

  // Altered payload or signature.
  const [head, body, signature] = token.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), sub: 'admin-1' })).toString('base64url');
  assert.equal(await readEmailVerificationToken(`${head}.${forgedBody}.${signature}`), null);
  assert.equal(await readEmailVerificationToken(`${head}.${body}.${signature.slice(0, -2)}xx`), null);

  // Signed with the raw session secret (a session cookie's key) instead of the derived key.
  const sessionKeyed = await new SignJWT({ purpose: 'email-verification', email: 'client@example.invalid' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject('user-1').setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  assert.equal(await readEmailVerificationToken(sessionKeyed), null);

  assert.equal(await readEmailVerificationToken(''), null);
  assert.equal(await readEmailVerificationToken('x'.repeat(5000)), null);
});

test('an expired or differently-purposed token is refused', async (t) => {
  withSecret(t);
  const { createHmac } = await import('node:crypto');
  const key = createHmac('sha256', process.env.SESSION_SECRET!).update('email-verification').digest();
  const expired = await new SignJWT({ purpose: 'email-verification', email: 'client@example.invalid' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject('user-1').setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(key);
  assert.equal(await readEmailVerificationToken(expired), null);
  const otherPurpose = await new SignJWT({ purpose: 'marketing-unsubscribe', email: 'client@example.invalid' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject('user-1').setExpirationTime('1h').sign(key);
  assert.equal(await readEmailVerificationToken(otherPurpose), null);
});

test('an address counts as proven by a used link, a redeemed reset or a linked Google account', () => {
  assert.equal(hasVerifiedEmail({ emailVerifiedAt: null, oauthAccounts: [] }), false);
  assert.equal(hasVerifiedEmail({ emailVerifiedAt: new Date(), oauthAccounts: [] }), true);
  assert.equal(hasVerifiedEmail({ emailVerifiedAt: null, oauthAccounts: [{ provider: 'google' }] }), true);
});

function routeFixture(user: { id: string; email: string; emailVerifiedAt: Date | null } | null) {
  const calls = { updates: 0, audits: [] as string[] };
  const route = loadServerModule<typeof import('../api/auth/verify-email/route')>('src/app/api/auth/verify-email/route.ts', {
    '@/app/lib/prisma': { user: {
      updateMany: async ({ where, data }: { where: { id: string; email: string; emailVerifiedAt: null }; data: { emailVerifiedAt: Date } }) => {
        calls.updates++;
        if (!user || user.id !== where.id || user.email !== where.email || user.emailVerifiedAt !== null) return { count: 0 };
        user.emailVerifiedAt = data.emailVerifiedAt;
        return { count: 1 };
      },
      findUnique: async () => (user ? { email: user.email, emailVerifiedAt: user.emailVerifiedAt } : null),
    } },
    '@/app/lib/audit': { appendAuditEvent: async ({ action }: { action: string }) => { calls.audits.push(action); } },
    '@/i18n/request': { getRequestLocale: async () => 'en-GB' },
  });
  const open = async (token: string) => {
    const response = await route.GET(new NextRequest(`https://salon.example/api/auth/verify-email?token=${encodeURIComponent(token)}`));
    const location = new URL(response.headers.get('location')!);
    return `${location.pathname}${location.search}`;
  };
  return { open, calls, user };
}

test('the emailed link confirms the address once, in the language it was sent in', async (t) => {
  withSecret(t);
  const f = routeFixture({ ...customer, emailVerifiedAt: null });
  const token = await createEmailVerificationToken(customer, 'zh-HK');
  assert.equal(await f.open(token), '/zh-hk/auth/verify-email?status=verified');
  assert.ok(f.user!.emailVerifiedAt);
  assert.deepEqual(f.calls.audits, ['AUTH.EMAIL_VERIFIED']);
  // A mail scanner opening it again still lands on "confirmed", and writes nothing.
  assert.equal(await f.open(token), '/zh-hk/auth/verify-email?status=verified');
  assert.deepEqual(f.calls.audits, ['AUTH.EMAIL_VERIFIED']);
});

test('a link for an address the account no longer has proves nothing', async (t) => {
  withSecret(t);
  const f = routeFixture({ ...customer, email: 'new-address@example.invalid', emailVerifiedAt: null });
  const token = await createEmailVerificationToken(customer, 'en-GB');
  assert.equal(await f.open(token), '/auth/verify-email?status=invalid');
  assert.equal(f.user!.emailVerifiedAt, null);
});

test('a forged link is refused before any database work', async (t) => {
  withSecret(t);
  const f = routeFixture({ ...customer, emailVerifiedAt: null });
  assert.equal(await f.open('not-a-token'), '/auth/verify-email?status=invalid');
  assert.equal(f.calls.updates, 0);
});

function resendFixture(user: { emailVerifiedAt: Date | null; oauthAccounts: { provider: string }[] }, allowed = true) {
  const sent: string[] = [];
  const actions = loadServerModule<typeof import('./email-verification')>('src/app/actions/email-verification.ts', {
    '@/app/lib/prisma': { user: { findUnique: async () => ({ ...customer, ...user }) } },
    '@/app/lib/session': { verifySession: async () => ({ userId: customer.id, role: 'USER' }) },
    '@/app/lib/rate-limit': { createRateLimiter: () => ({ check: async () => allowed }) },
    '@/app/services/email-service': { sendEmailVerification: async (to: { email: string }) => { sent.push(to.email); } },
  });
  return { resend: () => actions.resendVerificationEmail(), sent };
}

test('a customer can ask for a new link; a confirmed one is told so and sent nothing', async () => {
  const pending = resendFixture({ emailVerifiedAt: null, oauthAccounts: [] });
  assert.deepEqual(await pending.resend(), { status: 'sent' });
  assert.deepEqual(pending.sent, [customer.email]);

  const done = resendFixture({ emailVerifiedAt: new Date(), oauthAccounts: [] });
  assert.deepEqual(await done.resend(), { status: 'verified' });
  assert.deepEqual(done.sent, []);

  const limited = resendFixture({ emailVerifiedAt: null, oauthAccounts: [] }, false);
  assert.deepEqual(await limited.resend(), { status: 'error', message: translator('en-GB', 'auth')('verifyEmail.RATE_LIMITED') });
  assert.deepEqual(limited.sent, []);
});

test('an account with an unconfirmed address cannot hold a slot', async () => {
  let limiterChecks = 0;
  const actions = loadServerModule<typeof import('./booking')>('src/app/actions/booking.ts', {
    '@/app/lib/prisma': { user: { findUnique: async () => ({ emailVerifiedAt: null, oauthAccounts: [] }) } },
    '@/app/lib/booking-maintenance': { isBookingEnabled: async () => true },
    '@/app/lib/session': { verifySession: async () => ({ userId: customer.id, role: 'USER' }) },
    '@/app/lib/rate-limit': { bookingLimiter: { check: async () => { limiterChecks++; return true; } } },
    '@/app/services/booking-service': {},
    '@/app/services/notification-outbox-service': {},
    '@/app/services/stylist-ical-cache': {},
  });
  const result = await actions.submitBooking({ stylistId: 'stylist-1', serviceId: 'service-1', date: '2099-01-05', time: '10:00' });
  assert.deepEqual(result, { success: false, code: 'EMAIL_NOT_VERIFIED', error: translator('en-GB', 'errors')('booking.EMAIL_NOT_VERIFIED') });
  assert.equal(limiterChecks, 0, 'an unconfirmed account does not even spend its booking allowance');
});

test('registering sends the confirmation link after the response', async () => {
  const sent: { email: string; locale: string }[] = [];
  const { register } = loadServerModule<typeof import('./auth')>('src/app/actions/auth.ts', {
    '@/app/lib/prisma': { user: { findUnique: async () => null, create: async ({ data }: { data: { email: string; name: string } }) => ({ ...data, id: 'user-9', role: 'USER', sessionVersion: 0 }) } },
    '@/app/lib/password': { ...passwordModule, hashPassword: async () => 'hash' },
    '@/app/lib/session': { createSession: async () => {} },
    '@/app/lib/audit': {},
    'next/headers': { headers: async () => new Headers() },
    'next/server': { after: (callback: () => unknown) => callback() },
    'next/navigation': { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    '@/app/lib/rate-limit': { registerLimiter: { check: async () => true } },
    '@/app/services/email-service': { sendEmailVerification: async (user: { email: string }, locale: string) => { sent.push({ email: user.email, locale }); } },
  });
  const form = new FormData();
  form.set('email', 'New@Example.invalid'); form.set('name', 'New Customer'); form.set('password', 'a-good-password');
  await assert.rejects(register(undefined, form), /^Error: redirect:/);
  assert.deepEqual(sent, [{ email: 'new@example.invalid', locale: 'en-GB' }]);
});

test('redeeming a password reset link also confirms the address', async () => {
  const writes: Record<string, unknown>[] = [];
  const tx = {
    passwordResetToken: {
      updateMany: async () => ({ count: 1 }),
      deleteMany: async () => ({ count: 0 }),
    },
    user: { update: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return {}; } },
    auditEvent: { create: async () => ({ id: 'audit' }) },
  };
  const actions = loadServerModule<typeof import('./password-reset')>('src/app/actions/password-reset.ts', {
    '@/app/lib/prisma': {
      ...tx,
      passwordResetToken: { ...tx.passwordResetToken, findUnique: async () => ({ id: 't', userId: customer.id, expiresAt: new Date(Date.now() + 60_000), usedAt: null }) },
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    },
    '@/app/lib/password': { ...passwordModule, hashPassword: async () => 'hash' },
    'next/headers': { headers: async () => new Headers() },
    '@/app/lib/rate-limit': { passwordResetLimiter: { check: async () => true } },
    '@/app/services/email-service': {},
  });
  const form = new FormData();
  form.set('token', 'emailed-token'); form.set('password', 'a-new-password'); form.set('confirmPassword', 'a-new-password');
  assert.deepEqual(await actions.resetPassword({ status: 'idle' }, form), { status: 'success' });
  assert.ok(writes[0].emailVerifiedAt instanceof Date);
});
