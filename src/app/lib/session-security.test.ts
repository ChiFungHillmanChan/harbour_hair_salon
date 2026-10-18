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

function signOutFixture(t: TestContext, stored: { sessionVersion: number }, failWrite = false) {
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
    '@/app/lib/prisma': {
      user: {
        updateMany: async ({ where, data }: { where: { id: string; sessionVersion: number }; data: { sessionVersion: { increment: number } } }) => {
          if (failWrite) throw new Error('database unreachable');
          if (where.id !== 'customer' || where.sessionVersion !== stored.sessionVersion) return { count: 0 };
          stored.sessionVersion += data.sessionVersion.increment;
          return { count: 1 };
        },
      },
    },
  });
  t.mock.method(console, 'error', () => {});
  return { values, session };
}

test('signing out ends every session of the account, not only this cookie', async (t) => {
  const stored = { sessionVersion: 2 };
  const { session, values } = signOutFixture(t, stored);
  await session.createSession('customer', 'USER', 2);
  await session.endAllSessions();
  // Every token carrying version 2 — other devices, copied cookies — is now refused.
  assert.equal(stored.sessionVersion, 3);
  assert.equal(values.has('session'), false);
  assert.equal(values.has('session_hint'), false);
});

test('an already-revoked cookie cannot sign the owner out of their other devices', async (t) => {
  const stored = { sessionVersion: 5 };
  const { session, values } = signOutFixture(t, stored);
  await session.createSession('customer', 'USER', 4);
  await session.endAllSessions();
  assert.equal(stored.sessionVersion, 5);
  assert.equal(values.has('session'), false);
});

test('this browser is still signed out when the database cannot be reached', async (t) => {
  const stored = { sessionVersion: 0 };
  const { session, values } = signOutFixture(t, stored, true);
  await session.createSession('customer', 'USER', 0);
  await session.endAllSessions();
  assert.equal(values.has('session'), false);
  assert.equal(values.has('session_hint'), false);
});

test('a token stays current only until sign-out or a reset moves the account\'s version on', async (t) => {
  const current = fixture(t, 'USER', 0).session;
  assert.equal(await current.isSessionCurrent({ userId: 'customer', role: 'USER', sessionVersion: 0, expiresAt: new Date() }), true);
  const preClaim = { userId: 'customer', role: 'USER', expiresAt: new Date() } as unknown as Parameters<typeof current.isSessionCurrent>[0];
  assert.equal(await current.isSessionCurrent(preClaim), true, 'a token from before the claim counts as version 0');
  const revoked = fixture(t, 'USER', 1).session;
  assert.equal(await revoked.isSessionCurrent({ userId: 'customer', role: 'USER', sessionVersion: 0, expiresAt: new Date() }), false);
});

test('a token for an account that no longer exists is not current', async () => {
  const session = loadServerModule<typeof import('./session')>('src/app/lib/session.ts', {
    'next/headers': { cookies: async () => ({ get: () => undefined }) },
    'next/navigation': { redirect },
    '@/app/lib/prisma': { user: { findUnique: async () => null } },
  });
  assert.equal(await session.isSessionCurrent({ userId: 'gone', role: 'USER', sessionVersion: 0, expiresAt: new Date() }), false);
});
