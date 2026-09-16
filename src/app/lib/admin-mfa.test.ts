import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt } from 'jose';
import { redirect } from 'next/dist/client/components/redirect';
import { loadServerModule } from '../../test/load-server-module';

function fixture(t: TestContext) {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'fixture-mfa-challenge-signing-secret';
  t.after(() => { if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous; });
  const values = new Map<string, string>([['session', 'must-remove']]);
  const user = { id: 'admin-1', role: 'ADMIN', sessionVersion: 4, mfaEnabledAt: null };
  const auth = loadServerModule<typeof import('./admin-mfa')>('src/app/lib/admin-mfa.ts', {
    'next/headers': { cookies: async () => ({ get: (key: string) => ({ value: values.get(key) }), set: (key: string, value: string) => values.set(key, value), delete: (key: string) => values.delete(key) }) },
    'next/navigation': { redirect },
    '@/app/lib/prisma': { user: { findUnique: async () => user } },
    '@/app/lib/session': { deleteSession: async () => { values.delete('session'); } },
  });
  return { auth, user, values };
}

test('admin first factor creates a five-minute challenge and removes full session access', async (t) => {
  const { auth, values } = fixture(t);
  await auth.beginAdminMfaChallenge('admin-1', 4);
  assert.equal(values.has('session'), false);
  const token = decodeJwt(values.get('admin_mfa_pending')!);
  assert.equal(token.purpose, 'admin-mfa');
  assert.equal(token.exp! - token.iat!, 300);
  assert.equal(token.sessionVersion, 4);
  assert.equal((await auth.requirePendingAdminMfa()).id, 'admin-1');
});

test('a password reset or demotion invalidates the pending MFA challenge', async (t) => {
  const { auth, user } = fixture(t);
  await auth.beginAdminMfaChallenge('admin-1', 4);
  user.sessionVersion++;
  await assert.rejects(auth.requirePendingAdminMfa());
  user.sessionVersion = 4;
  user.role = 'USER';
  await assert.rejects(auth.requirePendingAdminMfa());
});
