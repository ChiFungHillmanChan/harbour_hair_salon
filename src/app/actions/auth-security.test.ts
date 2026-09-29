import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { fitsBcryptLimit } from '../lib/password';

for (const providers of [[], [{ provider: 'google' }]]) {
  test(`registration cannot take over a passwordless existing account with ${providers.length} linked providers`, async () => {
    let writes = 0;
    let sessions = 0;
    const { register } = loadServerModule<typeof import('./auth')>('src/app/actions/auth.ts', {
      '@/app/lib/prisma': { user: {
        findUnique: async () => ({ id: 'existing-user', password: null, role: 'USER', sessionVersion: 0, oauthAccounts: providers }),
        update: async () => { writes++; },
        create: async () => { writes++; return { id: 'new-user' }; },
      } },
      '@/app/lib/password': { fitsBcryptLimit, hashPassword: async () => 'fixture-hash' },
      '@/app/lib/session': { createSession: async () => { sessions++; } },
      '@/app/lib/admin-mfa': {},
      '@/app/lib/audit': {},
      'next/headers': { headers: async () => new Headers() },
      'next/navigation': { redirect: () => { throw new Error('Unexpected sign-in'); } },
      '@/app/lib/rate-limit': { registerLimiter: { check: async () => true } },
    });
    const form = new FormData();
    form.set('email', 'fixture@example.invalid');
    form.set('name', 'Attacker');
    form.set('password', 'fixture-password');
    const result = await register(undefined, form);
    assert.ok(result.error);
    assert.equal(writes, 0);
    assert.equal(sessions, 0);
  });
}

test('a passwordless guest receives an ownership-proof reset link without creating a login session', async () => {
  let sentToken = '';
  let storedHash = '';
  const actions = loadServerModule<typeof import('./password-reset')>('src/app/actions/password-reset.ts', {
    '@/app/lib/prisma': {
      user: { findUnique: async () => ({ id: 'guest-user', email: 'guest@example.invalid', name: 'Guest' }) },
      passwordResetToken: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }: { data: { tokenHash: string } }) => { storedHash = data.tokenHash; },
      },
      $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    },
    'next/headers': { headers: async () => new Headers() },
    '@/app/lib/rate-limit': {
      passwordResetLimiter: { check: async () => true },
      passwordResetAccountLimiter: { check: async () => true },
      accountRateLimitKey: (email: string) => email,
    },
    '@/app/services/email-service': { sendPasswordReset: async (_user: unknown, token: string) => { sentToken = token; } },
  });
  const form = new FormData();
  form.set('email', 'guest@example.invalid');
  const result = await actions.requestPasswordReset({ status: 'idle' }, form);
  assert.equal(result.status, 'sent');
  assert.equal(sentToken.length, 43);
  assert.equal(storedHash.length, 64);
  assert.notEqual(sentToken, storedHash);
});

test('administrator password login issues a full session without a second factor', async () => {
  // Admin sign-in is password-only by product decision. The session must be
  // marked verified, or verifySession/middleware would bounce an admin for a
  // factor nothing ever asks them for.
  let sessions = 0;
  let verifiedFlag: boolean | undefined;
  const { login } = loadServerModule<typeof import('./auth')>('src/app/actions/auth.ts', {
    '@/app/lib/prisma': { user: { findUnique: async () => ({ id: 'admin-1', password: 'hash', role: 'ADMIN', sessionVersion: 2 }) } },
    '@/app/lib/password': { verifyPassword: async () => true },
    '@/app/lib/session': { createSession: async (_id: string, _role: string, _v: number, verified?: boolean) => { sessions++; verifiedFlag = verified; } },
    '@/app/lib/audit': { appendAuditEvent: async () => {} },
    'next/headers': { headers: async () => new Headers() },
    'next/navigation': { redirect: (path: string) => { throw new Error(path); } },
    '@/app/lib/rate-limit': {
      loginLimiter: { check: async () => true },
      loginAccountLimiter: { check: async () => true },
      accountRateLimitKey: (email: string) => email,
    },
  });
  const form = new FormData(); form.set('email', 'admin@example.invalid'); form.set('password', 'fixture-password');
  await assert.rejects(login(undefined, form), /^Error: \/admin$/, 'an admin lands on the board, not an MFA screen');
  assert.equal(sessions, 1);
  assert.equal(verifiedFlag, true);
});
