import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { accountRateLimitKey, type RateLimiter } from '../lib/rate-limit';

const allow: RateLimiter = { check: async () => true, backend: () => 'memory' };

function resetFor(storedEmail: string) {
  const sent: string[] = [];
  const tokens: string[] = [];
  const { requestPasswordReset } = loadServerModule<typeof import('./password-reset')>('src/app/actions/password-reset.ts', {
    '@/app/lib/prisma': {
      user: { findUnique: async () => ({ id: 'user-1', email: storedEmail }) },
      passwordResetToken: { deleteMany: async () => ({ count: 0 }), create: async () => { tokens.push('created'); return {}; } },
      $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    },
    'next/headers': { headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }) },
    '@/app/lib/rate-limit': { passwordResetLimiter: allow, passwordResetAccountLimiter: allow, accountRateLimitKey, emailSendDailyLimiter: allow },
    '@/app/services/email-service': { sendPasswordReset: async (user: { email: string }) => { sent.push(user.email); } },
  });
  return { requestPasswordReset, sent, tokens };
}

test('a reset request for an erased or walk-in placeholder address sends nothing and says the usual thing', async () => {
  for (const stored of ['erased-user-1@erased.invalid']) {
    const { requestPasswordReset, sent, tokens } = resetFor(stored);
    const form = new FormData();
    form.set('email', stored);
    assert.deepEqual(await requestPasswordReset({ status: 'idle' } as never, form), { status: 'sent' });
    assert.deepEqual(sent, []);
    assert.deepEqual(tokens, [], 'no reset link is created for an address that cannot receive it');
  }
});

test('a real address still gets its link', async () => {
  const { requestPasswordReset, sent } = resetFor('ada@example.com');
  const form = new FormData();
  form.set('email', 'ada@example.com');
  assert.deepEqual(await requestPasswordReset({ status: 'idle' } as never, form), { status: 'sent' });
  assert.deepEqual(sent, ['ada@example.com']);
});
