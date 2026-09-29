import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { fitsBcryptLimit } from '../lib/password';

function resetFixture(expireDuringHash = false, failPasswordWrite = false) {
  const record = { id: 'token-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60_000), usedAt: null as Date | null };
  const user = { password: 'original', sessionVersion: 4, mfaSecretEncrypted: 'existing-encrypted-mfa', mfaEnabledAt: new Date() };
  const events: string[] = [];
  const tx = {
    auditEvent: { create: async ({ data }: { data: { action: string } }) => { events.push(data.action); return { id: 'audit-1' }; } },
    passwordResetToken: {
      findUnique: async () => ({ ...record }),
      updateMany: async ({ where, data }: { where: { usedAt: null; expiresAt?: { gt: Date } }; data: { usedAt: Date } }) => {
        if (record.usedAt !== null || (where.expiresAt && record.expiresAt <= where.expiresAt.gt)) return { count: 0 };
        record.usedAt = data.usedAt;
        return { count: 1 };
      },
      deleteMany: async () => ({ count: 0 }),
    },
    user: { update: async ({ data }: { data: { password: string } }) => {
      if (failPasswordWrite) throw new Error('database write failed');
      user.password = data.password;
      user.sessionVersion++;
      return user;
    } },
  };
  // Interactive transactions serialize token claims just as the row write lock
  // does. Array transactions exercise the old path, which ignored claim count.
  let tail = Promise.resolve<unknown>(undefined);
  const db = { ...tx, $transaction: (input: ((database: typeof tx) => Promise<unknown>) | Promise<unknown>[]) => {
    if (Array.isArray(input)) return Promise.all(input).catch((error) => { record.usedAt = null; throw error; });
    const operation = tail.then(async () => {
      const before = record.usedAt;
      try { return await input(tx); } catch (error) { record.usedAt = before; throw error; }
    });
    tail = operation.catch(() => undefined);
    return operation;
  } };
  const actions = loadServerModule<typeof import('./password-reset')>('src/app/actions/password-reset.ts', {
    '@/app/lib/prisma': db,
    'next/headers': { headers: async () => new Headers() },
    '@/app/lib/rate-limit': { passwordResetLimiter: { check: async () => true } },
    '@/app/lib/password': { fitsBcryptLimit, hashPassword: async (password: string) => {
      if (expireDuringHash) record.expiresAt = new Date(0);
      return `hash:${password}`;
    } },
    '@/app/services/email-service': {},
    '@/app/lib/session': { createSession: async () => { assert.fail('Password reset must not issue a full administrator session'); } },
  });
  const redeem = (password: string) => {
    const form = new FormData();
    form.set('token', 'valid-token'); form.set('password', password); form.set('confirmPassword', password);
    return actions.resetPassword({ status: 'idle' }, form);
  };
  return { redeem, user, record, events };
}

test('simultaneous redemption changes the password once and rejects the losing request', async () => {
  const { redeem, user, events } = resetFixture();
  const results = await Promise.all([redeem('password-one'), redeem('password-two')]);
  assert.equal(results.filter((result) => result.status === 'success').length, 1);
  assert.equal(results.filter((result) => result.status === 'error').length, 1);
  assert.equal(user.sessionVersion, 5);
  assert.equal(user.password, 'hash:password-one');
  assert.equal(user.mfaSecretEncrypted, 'existing-encrypted-mfa');
  assert.ok(user.mfaEnabledAt);
  assert.deepEqual(events, ['AUTH.PASSWORD_RESET']);
});

test('a token that expires before the claim cannot change the password', async () => {
  const { redeem, user, record } = resetFixture(true);
  const result = await redeem('new-password');
  assert.equal(result.status, 'error');
  assert.equal(user.password, 'original');
  assert.equal(user.sessionVersion, 4);
  assert.equal(record.usedAt, null);
});

test('a password write failure rolls back the token claim', async () => {
  const { redeem, user, record } = resetFixture(false, true);
  const result = await redeem('new-password');
  assert.equal(result.status, 'error');
  assert.equal(user.password, 'original');
  assert.equal(record.usedAt, null);
});
