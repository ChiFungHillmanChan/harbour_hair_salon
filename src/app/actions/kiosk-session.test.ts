import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { redirect } from 'next/dist/client/components/redirect';
import { loadServerModule } from '../../test/load-server-module';
import type { KioskSession } from '@prisma/client';
import { SignJWT } from 'jose';

function kioskFixture(t: TestContext, databaseRole = 'ADMIN') {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'kiosk-handoff-test-secret-32-characters';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  });

  const cookieValues = new Map<string, string>();
  const devices = new Map<string, KioskSession>();
  const auditEvents: { action: string }[] = [];
  const tx = {
    user: { findUnique: async () => ({ role: databaseRole, sessionVersion: 0, mfaEnabledAt: new Date() }) },
    auditEvent: { create: async ({ data }: { data: { action: string } }) => { auditEvents.push(data); return { id: 'audit-1' }; } },
    kioskSession: {
      create: async ({ data }: { data: Pick<KioskSession, 'deviceName' | 'expiresAt' | 'createdByAdminId'> }) => {
        const device = { id: `device-${devices.size + 1}`, ...data, createdAt: new Date(), revokedAt: null };
        devices.set(device.id, device);
        return device;
      },
      findUnique: async ({ where }: { where: { id: string } }) => devices.get(where.id) ?? null,
      findMany: async () => [...devices.values()],
      updateMany: async ({ where, data }: { where: { id?: string; revokedAt?: null }; data: { revokedAt: Date } }) => {
        let count = 0;
        for (const device of devices.values()) {
          if (where.id && where.id !== device.id) continue;
          if (where.revokedAt === null && device.revokedAt !== null) continue;
          Object.assign(device, data);
          count++;
        }
        return { count };
      },
    },
  };
  const db = { ...tx, $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) };
  const cookies = {
    get: (name: string) => cookieValues.has(name) ? { value: cookieValues.get(name)! } : undefined,
    set: (name: string, value: string) => { cookieValues.set(name, value); },
    delete: (name: string) => { cookieValues.delete(name); },
  };
  const session = loadServerModule<typeof import('../lib/session')>('src/app/lib/session.ts', {
    'next/headers': { cookies: async () => cookies },
    // Use Next's real redirect without importing the client-only navigation hooks.
    'next/navigation': { redirect },
    '@/app/lib/prisma': db,
  });
  const actions = loadServerModule<typeof import('./kiosk')>('src/app/actions/kiosk.ts', {
    'next/navigation': { redirect },
    '@/app/lib/session': session,
    '@/app/lib/prisma': db,
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    'next/cache': { revalidatePath: () => {} },
    '@/app/services/booking-service': {},
    '@/app/lib/rate-limit': {},
  });
  const { middleware } = loadServerModule<typeof import('../../middleware')>('src/middleware.ts', {});
  const visit = (path: string) => middleware(new NextRequest(`https://salon.test${path}`, {
    headers: { cookie: Array.from(cookieValues, ([name, value]) => `${name}=${value}`).join('; ') },
  }));
  return { cookieValues, session, actions, visit, devices, auditEvents };
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
  await session.createSession('admin-1', 'ADMIN', 0, true);
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

test('disabling this kiosk revokes a copied token on the server', async (t) => {
  const { session, actions, cookieValues, auditEvents } = kioskFixture(t);
  await session.createSession('admin-1', 'ADMIN', 0, true);
  await assert.rejects(actions.enableKioskMode(), redirectsTo('/kiosk'));
  const copiedToken = cookieValues.get('kiosk')!;
  await session.createSession('admin-1', 'ADMIN', 0, true);
  await actions.disableKioskMode();
  assert.equal(cookieValues.has('kiosk'), false);
  cookieValues.set('kiosk', copiedToken);
  assert.equal(await session.getKioskSession(), false);
  assert.deepEqual(auditEvents.map((event) => event.action), ['KIOSK.ENABLED', 'KIOSK.REVOKED']);
});

test('an admin can revoke another kiosk without its cookie', async (t) => {
  const { session, actions, cookieValues, devices } = kioskFixture(t);
  await session.createSession('admin-1', 'ADMIN', 0, true);
  await assert.rejects(actions.enableKioskMode('Reception tablet'), redirectsTo('/kiosk'));
  const copiedToken = cookieValues.get('kiosk')!;
  const device = [...devices.values()][0];
  assert.ok(device, 'enabling must register a revocable device');
  assert.equal(device.deviceName, 'Reception tablet');
  cookieValues.delete('kiosk');
  await session.createSession('admin-1', 'ADMIN', 0, true);
  await actions.revokeKioskSession(device.id);
  cookieValues.set('kiosk', copiedToken);
  assert.equal(await session.getKioskSession(), false);
});

test('server-expired devices and legacy unregistered kiosk tokens are rejected', async (t) => {
  const { session, actions, cookieValues, devices } = kioskFixture(t);
  await session.createSession('admin-1', 'ADMIN', 0, true);
  await assert.rejects(actions.enableKioskMode(), redirectsTo('/kiosk'));
  const device = [...devices.values()][0];
  assert.ok(device, 'enabling must register a revocable device');
  device.expiresAt = new Date(0);
  assert.equal(await session.getKioskSession(), false);
  const legacy = await new SignJWT({ kiosk: true }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('365d').sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  cookieValues.set('kiosk', legacy);
  assert.equal(await session.getKioskSession(), false);
});

test('a customer cannot revoke any kiosk devices', async (t) => {
  const { session, actions } = kioskFixture(t, 'USER');
  await session.createSession('customer-1', 'USER', 0);
  assert.equal(typeof actions.revokeKioskSession, 'function');
  await assert.rejects(actions.revokeKioskSession('device-1'), redirectsTo('/'));
  await assert.rejects(actions.revokeAllKioskSessions(), redirectsTo('/'));
  await assert.rejects(actions.listKioskSessions(), redirectsTo('/'));
});

test('revoking every kiosk removes access on every registered device', async (t) => {
  const { session, actions, cookieValues } = kioskFixture(t);
  const tokens: string[] = [];
  for (const name of ['Reception', 'Staff room']) {
    await session.createSession('admin-1', 'ADMIN', 0, true);
    await assert.rejects(actions.enableKioskMode(name), redirectsTo('/kiosk'));
    tokens.push(cookieValues.get('kiosk')!);
    cookieValues.delete('kiosk');
  }
  await session.createSession('admin-1', 'ADMIN', 0, true);
  assert.equal(typeof actions.revokeAllKioskSessions, 'function');
  await actions.revokeAllKioskSessions();
  for (const token of tokens) {
    cookieValues.set('kiosk', token);
    assert.equal(await session.getKioskSession(), false);
  }
});
