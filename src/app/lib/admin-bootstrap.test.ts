import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { PrismaClient } from '@prisma/client';
import { loadServerModule } from '../../test/load-server-module';

test('offline bootstrap atomically revokes existing sessions, preserves MFA and audits without credentials', async () => {
  let upsert: Record<string, unknown> = {};
  const events: Record<string, unknown>[] = [];
  const tx = {
    user: { upsert: async (args: Record<string, unknown>) => { upsert = args; return { id: 'bootstrap-admin' }; } },
    auditEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return { id: 'audit-bootstrap' }; } },
  };
  const db = { $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) } as unknown as PrismaClient;
  const maintenance = loadServerModule<typeof import('./mfa-maintenance')>('src/app/lib/mfa-maintenance.ts', {
    '@/app/lib/password': { hashPassword: async () => 'fixture-password-hash' },
  });
  await maintenance.bootstrapAdminOffline(db, { name: 'Bootstrap Admin', email: ' Admin@Example.Invalid ', password: 'private-first-password', ticket: 'CHANGE-123', operatorId: 'ops-first-admin' });
  assert.deepEqual(upsert.where, { email: 'admin@example.invalid' });
  assert.deepEqual(upsert.update, { name: 'Bootstrap Admin', password: 'fixture-password-hash', role: 'ADMIN', sessionVersion: { increment: 1 } });
  assert.deepEqual(upsert.create, { name: 'Bootstrap Admin', email: 'admin@example.invalid', password: 'fixture-password-hash', role: 'ADMIN' });
  assert.deepEqual(events, [{ actorUserId: 'ops-first-admin', action: 'ADMIN.BOOTSTRAPPED', targetType: 'User', targetId: 'bootstrap-admin', metadataJson: '{"ticket":"CHANGE-123"}' }]);
});

test('offline bootstrap refuses missing approval references or invalid credentials before a write', async () => {
  let writes = 0;
  const db = { $transaction: async () => { writes++; } } as unknown as PrismaClient;
  const maintenance = loadServerModule<typeof import('./mfa-maintenance')>('src/app/lib/mfa-maintenance.ts', {});
  for (const input of [
    { name: 'Admin', email: 'admin@example.invalid', password: 'password-value', ticket: '' },
    { name: 'Admin', email: 'not-email', password: 'password-value', ticket: 'CHANGE-123' },
    { name: 'Admin', email: 'admin@example.invalid', password: 'short', ticket: 'CHANGE-123' },
  ]) await assert.rejects(() => maintenance.bootstrapAdminOffline(db, { ...input, operatorId: 'ops-first-admin' }));
  await assert.rejects(() => maintenance.bootstrapAdminOffline(db, { name: 'Admin', email: 'admin@example.invalid', password: 'password-value', ticket: 'CHANGE-123', operatorId: '' }));
  assert.equal(writes, 0);
});

test('bootstrap CLI rejects legacy arguments and unconfirmed targets without echoing credentials', () => {
  const base = ['--conditions=react-server', '--import', 'tsx', 'prisma/create-admin.ts'];
  for (const args of [[], ['fixture-name', 'fixture@example.invalid', 'fixture-password-must-not-be-logged']]) {
    const result = spawnSync(process.execPath, [...base, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' }, timeout: 10_000 });
    assert.equal(result.status, 1);
    const output = result.stdout + result.stderr;
    assert.match(output, /Administrator bootstrap failed/);
    assert.ok(!output.includes('fixture-name') && !output.includes('fixture@example.invalid') && !output.includes('fixture-password-must-not-be-logged'));
  }
});
