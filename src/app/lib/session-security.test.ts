import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt, SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { redirect } from 'next/dist/client/components/redirect';
import { loadServerModule } from '../../test/load-server-module';

function fixture(t: TestContext, role = 'ADMIN', sessionVersion = 0) {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'fixture-session-security-test-secret';
  t.after(() => { if (previousSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previousSecret; });
  const values = new Map<string, string>();
  const store = {
    get: (key: string) => values.has(key) ? { value: values.get(key)! } : undefined,
    set: (key: string, value: string) => { values.set(key, value); },
    delete: (key: string) => { values.delete(key); },
  };
  const session = loadServerModule<typeof import('./session')>('src/app/lib/session.ts', {
    'next/headers': { cookies: async () => store },
    'next/navigation': { redirect },
    '@/app/lib/prisma': { user: { findUnique: async () => ({ role, sessionVersion }) } },
  });
  return { values, session };
}

test('new admin cookies have a fixed eight-hour lifetime', async (t) => {
  const { session, values } = fixture(t);
  await session.createSession('admin', 'ADMIN', 0);
  const token = decodeJwt(values.get('session')!);
  assert.equal(token.exp! - token.iat!, 8 * 60 * 60);
});

test('new customer cookies keep their fixed thirty-day lifetime', async (t) => {
  const { session, values } = fixture(t, 'USER');
  await session.createSession('customer', 'USER', 0);
  const token = decodeJwt(values.get('session')!);
  assert.equal(token.exp! - token.iat!, 30 * 24 * 60 * 60);
});

test('a demoted user cannot pass the reusable admin guard', async (t) => {
  const { session } = fixture(t, 'USER');
  await session.createSession('former-admin', 'ADMIN', 0);
  assert.equal(typeof session.requireAdmin, 'function');
  await assert.rejects(session.requireAdmin(), (error: unknown) => error instanceof Error && 'digest' in error);
});

test('a password-reset session cannot pass the reusable admin guard', async (t) => {
  const { session } = fixture(t, 'ADMIN', 1);
  await session.createSession('admin', 'ADMIN', 0);
  assert.equal(typeof session.requireAdmin, 'function');
  await assert.rejects(session.requireAdmin(), (error: unknown) => error instanceof Error && 'digest' in error);
});

test('middleware never renews a nearly expired session using stale claims', async (t) => {
  fixture(t);
  const token = await new SignJWT({ userId: 'customer', role: 'USER', sessionVersion: 0, expiresAt: new Date(Date.now() + 60_000) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('60s')
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  const { middleware } = loadServerModule<typeof import('../../middleware')>('src/middleware.ts', {});
  const result = await middleware(new NextRequest('https://salon.test/appointments', { headers: { cookie: `session=${token}` } }));
  assert.equal(result.status, 200);
  assert.equal(result.cookies.get('session'), undefined);
});

test('a password-only administrator session reaches protected actions', async (t) => {
  // Admin sign-in is password-only by product decision: no second factor is
  // demanded anywhere. The revocation guards below still apply to them.
  const { session } = fixture(t);
  await session.createSession('admin', 'ADMIN', 0);
  assert.deepEqual(await session.verifySession(), { userId: 'admin', role: 'ADMIN' });
  assert.deepEqual(await session.requireAdmin(), { userId: 'admin', role: 'ADMIN' });
});
