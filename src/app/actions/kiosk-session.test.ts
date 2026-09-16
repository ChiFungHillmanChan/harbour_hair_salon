import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { redirect } from 'next/dist/client/components/redirect';
import { loadServerModule } from '../../test/load-server-module';

function kioskFixture(t: TestContext, databaseRole = 'ADMIN') {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'kiosk-handoff-test-secret-32-characters';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  });

  const cookieValues = new Map<string, string>();
  const cookies = {
    get: (name: string) => cookieValues.has(name) ? { value: cookieValues.get(name)! } : undefined,
    set: (name: string, value: string) => { cookieValues.set(name, value); },
    delete: (name: string) => { cookieValues.delete(name); },
  };
  const session = loadServerModule<typeof import('../lib/session')>('src/app/lib/session.ts', {
    'next/headers': { cookies: async () => cookies },
    // Use Next's real redirect without importing the client-only navigation hooks.
    'next/navigation': { redirect },
    '@/app/lib/prisma': {
      user: { findUnique: async () => ({ role: databaseRole, sessionVersion: 0 }) },
    },
  });
  const actions = loadServerModule<typeof import('./kiosk')>('src/app/actions/kiosk.ts', {
    'next/navigation': { redirect },
    '@/app/lib/session': session,
    '@/app/lib/prisma': {},
    '@/app/services/booking-service': {},
    '@/app/lib/rate-limit': {},
  });
  const { middleware } = loadServerModule<typeof import('../../middleware')>('src/middleware.ts', {});
  const visit = (path: string) => middleware(new NextRequest(`https://salon.test${path}`, {
    headers: { cookie: Array.from(cookieValues, ([name, value]) => `${name}=${value}`).join('; ') },
  }));
  return { cookieValues, session, actions, visit };
}

function redirectsTo(path: string) {
  return (error: unknown) => error instanceof Error
    && 'digest' in error
    && typeof error.digest === 'string'
    && error.digest.split(';')[0] === 'NEXT_REDIRECT'
    && error.digest.split(';')[2] === path;
}

test('entering kiosk signs out the admin while preserving authenticated kiosk access', async (t) => {
  const { session, actions, cookieValues, visit } = kioskFixture(t);
  await session.createSession('admin-1', 'ADMIN', 0);
  assert.equal((await visit('/admin')).status, 200);

  await assert.rejects(actions.enableKioskMode(), redirectsTo('/kiosk'));

  assert.equal(cookieValues.has('session'), false);
  assert.equal(cookieValues.has('session_hint'), false);
  assert.equal(await session.getKioskSession(), true);
  assert.equal((await visit('/kiosk')).status, 200);
  const adminResponse = await visit('/admin');
  assert.equal(adminResponse.status, 307);
  assert.equal(adminResponse.headers.get('location'), 'https://salon.test/auth/signin');
  await assert.rejects(session.verifySession(), redirectsTo('/auth/signin'));
});

for (const tokenRole of ['USER', 'ADMIN']) {
  test(`a ${tokenRole} token with a current customer role cannot enable kiosk or lose its session`, async (t) => {
    const { session, actions, cookieValues } = kioskFixture(t, 'USER');
    await session.createSession('customer-1', tokenRole, 0);
    const before = new Map(cookieValues);

    assert.deepEqual(await actions.enableKioskMode(), { error: 'Unauthorized' });

    assert.deepEqual(cookieValues, before);
    assert.equal(await session.getKioskSession(), false);
  });
}

test('an anonymous device cannot enable kiosk mode', async (t) => {
  const { actions, cookieValues, session } = kioskFixture(t);

  await assert.rejects(actions.enableKioskMode(), redirectsTo('/auth/signin'));

  assert.equal(cookieValues.size, 0);
  assert.equal(await session.getKioskSession(), false);
});
