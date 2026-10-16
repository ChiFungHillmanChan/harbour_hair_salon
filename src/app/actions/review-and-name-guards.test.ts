import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { fitsBcryptLimit } from '../lib/password';
import { translator } from '../../i18n/messages';

// Security review 2026-10-16.

// --- Reviews: only a visit that happened, by whoever proved the address ------

function reviewAs(appointment: { status: string; date: Date }, account: { emailVerifiedAt: Date | null; oauthAccounts: { provider: string }[] }) {
  const created: unknown[] = [];
  const { createReview } = loadServerModule<typeof import('./reviews')>('src/app/actions/reviews.ts', {
    '@/app/lib/prisma': {
      appointment: { findUnique: async () => ({ id: 'appt-1', userId: 'user-1', review: null, ...appointment }) },
      user: { findUnique: async () => account },
      review: { create: async (input: unknown) => { created.push(input); return {}; } },
    },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1', role: 'USER' }) },
    '@/i18n/request': { getActionT: async () => translator('en-GB', 'reviews') },
    '@/i18n/revalidate': { revalidateAllLocales: () => {} },
    'next/cache': { revalidatePath: () => {} },
  });
  const form = new FormData();
  form.set('appointmentId', 'appt-1');
  form.set('rating', '5');
  form.set('comment', '');
  return { submit: () => createReview({}, form), created };
}

const PAST = new Date('2020-01-01T10:00:00Z');
const verified = { emailVerifiedAt: new Date('2019-01-01T00:00:00Z'), oauthAccounts: [] };
const t = translator('en-GB', 'reviews');

test('a request staff never confirmed is not a visit: it cannot be reviewed', async () => {
  const { submit, created } = reviewAs({ status: 'PENDING', date: PAST }, verified);
  assert.deepEqual(await submit(), { error: t('errors.CANCELLED') });
  assert.equal(created.length, 0);
});

test('an account that never confirmed its email cannot review', async () => {
  const { submit, created } = reviewAs({ status: 'COMPLETED', date: PAST }, { emailVerifiedAt: null, oauthAccounts: [] });
  assert.deepEqual(await submit(), { error: t('errors.EMAIL_NOT_VERIFIED') });
  assert.equal(created.length, 0);
});

test('a confirmed or completed visit by a proved address can be reviewed', async () => {
  for (const status of ['CONFIRMED', 'COMPLETED']) {
    const { submit, created } = reviewAs({ status, date: PAST }, verified);
    assert.deepEqual(await submit(), { success: true }, status);
    assert.equal(created.length, 1, status);
  }
});

// --- Registration: a name is a name ------------------------------------------

function registerWithName(name: string) {
  let writes = 0;
  const { register } = loadServerModule<typeof import('./auth')>('src/app/actions/auth.ts', {
    '@/app/lib/prisma': { user: {
      findUnique: async () => null,
      create: async () => { writes++; return { id: 'new-user' }; },
    } },
    '@/app/lib/password': { fitsBcryptLimit, hashPassword: async () => 'fixture-hash' },
    '@/app/lib/session': { createSession: async () => {} },
    '@/app/lib/admin-mfa': {},
    '@/app/lib/audit': {},
    'next/headers': { headers: async () => new Headers() },
    'next/navigation': { redirect: () => { throw new Error('Unexpected sign-in'); } },
    '@/app/lib/rate-limit': { registerLimiter: { check: async () => true }, emailSendDailyLimiter: { check: async () => true } },
  });
  const form = new FormData();
  form.set('email', 'fixture@example.invalid');
  form.set('name', name);
  form.set('password', 'fixture-password');
  return { result: register(undefined, form), writes: () => writes };
}

test('a registration name cannot carry a link, an address or extra lines', async () => {
  const invalid = translator('en-GB', 'auth')('errors.NAME_INVALID');
  for (const name of ['Ana – pay at https://harbourhair-pay.example', 'Ana www.example.com', 'ana@example.com', 'Ana\nDeposit failed', 'Ana <b>']) {
    const attempt = registerWithName(name);
    const result = await attempt.result;
    assert.ok(result?.error?.includes(invalid), JSON.stringify(name));
    assert.equal(attempt.writes(), 0, JSON.stringify(name));
  }
});
