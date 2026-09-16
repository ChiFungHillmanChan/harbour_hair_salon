import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { encryptMfaSecret, decryptMfaSecret } from './mfa-crypto';
import { maintenanceDatabaseUrl, rotateMfaKeys, resetAdminMfaOffline } from './mfa-maintenance';

test('MFA maintenance requires an explicit target and a maintenance confirmation', () => {
  assert.throws(() => maintenanceDatabaseUrl({}));
  assert.throws(() => maintenanceDatabaseUrl({ SALON_AUTH_MAINTENANCE: 'confirmed' }));
  assert.equal(maintenanceDatabaseUrl({ SALON_AUTH_MAINTENANCE: 'confirmed', SALON_AUTH_MAINTENANCE_DATABASE_URL: 'postgresql://fixture:fixture@localhost/test' }), 'postgresql://fixture:fixture@localhost/test');
});

test('key rotation is restartable and audits only successful compare-and-swap changes', async () => {
  const oldKey = 'old-fixture-session-secret-32-characters';
  const newKey = 'new-fixture-session-secret-32-characters';
  const row = { id: 'admin-1', sessionVersion: 1, mfaSecretEncrypted: encryptMfaSecret('JBSWY3DPEHPK3PXP', oldKey), mfaPendingSecretEncrypted: null };
  const audits: string[] = [];
  const tx = {
    user: { updateMany: async ({ data }: { data: { mfaSecretEncrypted: string } }) => { row.mfaSecretEncrypted = data.mfaSecretEncrypted; row.sessionVersion++; return { count: 1 }; } },
    auditEvent: { create: async ({ data }: { data: { action: string } }) => { audits.push(data.action); return { id: 'event-1' }; } },
  };
  const db = {
    user: { findMany: async ({ cursor }: { cursor?: unknown }) => cursor ? [] : [{ ...row }] },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as PrismaClient;
  assert.deepEqual(await rotateMfaKeys(db, oldKey, newKey), { rotated: 1, alreadyRotated: 0 });
  assert.equal(decryptMfaSecret(row.mfaSecretEncrypted, newKey), 'JBSWY3DPEHPK3PXP');
  assert.deepEqual(await rotateMfaKeys(db, oldKey, newKey), { rotated: 0, alreadyRotated: 1 });
  assert.deepEqual(audits, ['AUTH.MFA_KEY_ROTATED']);
});

test('offline recovery refuses an operator who is not an administrator', async () => {
  let writes = 0;
  const tx = { user: {
    findUnique: async () => ({ role: 'USER' }),
    updateMany: async () => { writes++; return { count: 1 }; },
  } };
  const db = { $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) } as unknown as PrismaClient;
  await assert.rejects(resetAdminMfaOffline(db, 'admin-1', 'operator-1', 'INCIDENT-123'));
  assert.equal(writes, 0);
});

test('offline recovery revokes sessions, clears factors and records its operator without replacing primary credentials', async () => {
  let written: Record<string, unknown> = {};
  const events: Record<string, unknown>[] = [];
  const tx = { user: {
    findUnique: async () => ({ role: 'ADMIN' }),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      assert.deepEqual(where, { id: 'admin-1', role: 'ADMIN' });
      written = data;
      return { count: 1 };
    },
  }, auditEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return { id: 'audit-reset' }; } } };
  const db = { $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) } as unknown as PrismaClient;
  await resetAdminMfaOffline(db, 'admin-1', 'operator-1', 'INCIDENT-123');
  assert.deepEqual(written, {
    mfaSecretEncrypted: null, mfaEnabledAt: null, mfaLastUsedStep: null, mfaRecoveryCodesJson: '[]',
    mfaPendingSecretEncrypted: null, mfaPendingExpiresAt: null, sessionVersion: { increment: 1 },
  });
  assert.deepEqual(events, [{ actorUserId: 'operator-1', action: 'AUTH.MFA_RESET', targetType: 'User', targetId: 'admin-1', metadataJson: '{"ticket":"INCIDENT-123"}' }]);
});

test('rotation aborts a concurrent account change without recording success or issuing another write', async () => {
  const oldKey = 'old-fixture-session-secret-32-characters';
  const newKey = 'new-fixture-session-secret-32-characters';
  let writes = 0;
  let audits = 0;
  const tx = {
    user: { updateMany: async () => { writes++; return { count: 0 }; } },
    auditEvent: { create: async () => { audits++; return { id: 'audit' }; } },
  };
  const db = {
    user: { findMany: async () => [{ id: 'admin-1', sessionVersion: 1, mfaSecretEncrypted: encryptMfaSecret('JBSWY3DPEHPK3PXP', oldKey), mfaPendingSecretEncrypted: null }] },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as PrismaClient;
  await assert.rejects(rotateMfaKeys(db, oldKey, newKey), /Account changed/);
  assert.equal(writes, 1);
  assert.equal(audits, 0);
});
