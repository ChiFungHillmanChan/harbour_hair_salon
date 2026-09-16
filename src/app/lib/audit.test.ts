import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import { loadServerModule } from '../../test/load-server-module';

test('audit events use the supplied transaction and exclude credential/PII metadata', async () => {
  const writes: Prisma.AuditEventCreateInput[] = [];
  const tx = { auditEvent: { create: async ({ data }: { data: Prisma.AuditEventCreateInput }) => { writes.push(data); return { id: 'audit-1' }; } } };
  const { appendAuditEvent } = loadServerModule<typeof import('./audit')>('src/app/lib/audit.ts', {
    '@/app/lib/prisma': { auditEvent: { create: () => { throw new Error('Audit escaped transaction'); } } },
  });
  await appendAuditEvent({ actorUserId: 'admin-1', action: 'ADMIN.PROMOTE', targetType: 'User', targetId: 'user-1', metadata: { role: 'ADMIN', count: 1, password: 'never-store', accessToken: 'never-store', email: 'private@example.invalid' } }, tx as unknown as Prisma.TransactionClient);
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].metadataJson as string), { role: 'ADMIN', count: 1 });
});

test('audit refuses uncontrolled action names and oversized target IDs', async () => {
  let writes = 0;
  const { appendAuditEvent } = loadServerModule<typeof import('./audit')>('src/app/lib/audit.ts', {
    '@/app/lib/prisma': { auditEvent: { create: async () => { writes++; } } },
  });
  await assert.rejects(appendAuditEvent({ action: 'LOGIN\nraw content', targetType: 'User' }));
  await assert.rejects(appendAuditEvent({ action: 'LOGIN', targetType: 'User', targetId: 'a'.repeat(129) }));
  assert.equal(writes, 0);
});
