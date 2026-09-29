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
