import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { fitsBcryptLimit } from '../lib/password';

test('administrator password reset audits the actor, revokes outstanding reset links and preserves MFA enrollment in the same transaction', async () => {
  const events: { action: string; actorUserId: string }[] = [];
  let write: Record<string, unknown> = {};
  const revoked: unknown[] = [];
  const tx = {
    user: {
      findUnique: async () => ({ role: 'ADMIN' }),
      update: async ({ data }: { data: Record<string, unknown> }) => { write = data; return {}; },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { write = data; return { count: 1 }; },
    },
    passwordResetToken: { deleteMany: async ({ where }: { where: unknown }) => { revoked.push(where); return { count: 1 }; } },
  };
  const db = { ...tx, $transaction: async (run: (db: typeof tx) => Promise<unknown>) => run(tx) };
  const actions = loadServerModule<typeof import('./admin')>('src/app/actions/admin.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/session': { verifySession: async () => ({ userId: 'acting-admin', role: 'ADMIN' }) },
    '@/app/lib/password': { fitsBcryptLimit, hashPassword: async () => 'new-hash' },
    '@/app/lib/audit': { appendAuditEvent: async (event: typeof events[number], client: unknown) => { assert.equal(client, tx); events.push(event); } },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    'next/cache': { revalidatePath: () => {} },
    '@/app/actions/admin-services': {},
    '@/app/services/treatwell-api': {},
    '@/app/services/notification-outbox-service': {},
    '@/app/services/integration-readiness': {},
    '@/app/services/booking-service': {},
  });
  assert.deepEqual(await actions.resetUserPassword('target-admin', 'new-password'), { success: true });
  assert.deepEqual(write, { password: 'new-hash', sessionVersion: { increment: 1 } });
  assert.deepEqual(revoked, [{ userId: 'target-admin', usedAt: null }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'ADMIN.PASSWORD_RESET');
  assert.equal(events[0].actorUserId, 'acting-admin');
});

function deleteHarness(appointments: number) {
  const calls: string[] = [];
  const events: { action: string; targetId?: string }[] = [];
  const tx = {
    appointment: { count: async () => { calls.push('count'); return appointments; } },
    user: { delete: async ({ where }: { where: { id: string; role: string } }) => { calls.push(`delete:${where.id}:${where.role}`); return {}; } },
  };
  const actions = loadServerModule<typeof import('./admin')>('src/app/actions/admin.ts', {
    '@/app/lib/prisma': {},
    '@/app/lib/session': { verifySession: async () => ({ userId: 'acting-admin', role: 'ADMIN' }) },
    '@/app/lib/audit': { appendAuditEvent: async (event: typeof events[number], client: unknown) => { assert.equal(client, tx); events.push(event); } },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    'next/cache': { revalidatePath: () => {} },
    '@/app/actions/admin-services': {},
    '@/app/services/treatwell-api': {},
    '@/app/services/notification-outbox-service': {},
    '@/app/services/integration-readiness': {},
    // The count and the delete share one Serializable transaction.
    '@/app/services/booking-service': { runSerializableWithRetry: async (fn: (client: typeof tx) => Promise<unknown>) => { calls.push('serializable'); return fn(tx); } },
  });
  return { actions, calls, events };
}

test('deleting an administrator counts their bookings and deletes in the same Serializable transaction', async () => {
  const h = deleteHarness(0);
  assert.deepEqual(await h.actions.deleteAdminUser('other-admin'), { success: true });
  assert.deepEqual(h.calls, ['serializable', 'count', 'delete:other-admin:ADMIN']);
  assert.deepEqual(h.events.map((event) => [event.action, event.targetId]), [['ADMIN.DELETED', 'other-admin']]);
});

test('an administrator with bookings is never deleted: their appointments would cascade away with the row', async () => {
  const h = deleteHarness(2);
  const result = await h.actions.deleteAdminUser('other-admin');
  assert.ok('error' in result && /2/.test(String(result.error)), 'says how many bookings keep the account');
  assert.deepEqual(h.calls, ['serializable', 'count'], 'no delete');
  assert.deepEqual(h.events, []);
});

