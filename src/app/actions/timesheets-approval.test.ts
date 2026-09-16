import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

function fixture(change?: 'reopen' | 'edit', failAudit = false) {
  let entry = { id: 'entry-1', clockOut: new Date('2026-09-01T16:00:00Z') as Date | null, updatedAt: new Date('2026-09-01T16:01:00Z'), status: 'EDITED' };
  const events: unknown[] = [];
  const tx = {
    timeEntry: {
      update: async ({ data }: { data: Partial<typeof entry> }) => { Object.assign(entry, data); return { ...entry }; },
      updateMany: async ({ where, data }: { where: { updatedAt?: Date; clockOut?: { not: null } }; data: Partial<typeof entry> }) => {
        if ((where.updatedAt && where.updatedAt.getTime() !== entry.updatedAt.getTime()) || (where.clockOut && entry.clockOut === null)) return { count: 0 };
        Object.assign(entry, data); return { count: 1 };
      },
    },
    auditEvent: { create: async (event: unknown) => { if (failAudit) throw new Error('audit storage unavailable'); events.push(event); return { id: 'audit-1' }; } },
  };
  const db = {
    timeEntry: { findUnique: async () => {
      const read = { ...entry };
      // Another action commits after approval loaded its preconditions.
      if (change) entry = { ...entry, clockOut: change === 'reopen' ? null : new Date('2026-09-01T17:00:00Z'), updatedAt: new Date('2026-09-01T16:02:00Z') };
      return read;
    } },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => {
      const before = { ...entry };
      try { return await run(tx); } catch (error) { entry = before; throw error; }
    },
  };
  const audit = loadServerModule<typeof import('../lib/audit')>('src/app/lib/audit.ts', { '@/app/lib/prisma': db });
  const writes = loadServerModule<typeof import('../lib/audited-write')>('src/app/lib/audited-write.ts', { './prisma': db, './audit': audit });
  const actions = loadServerModule<typeof import('./timesheets')>('src/app/actions/timesheets.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/audited-write': writes,
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: 'ADMIN' }) },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    'next/cache': { revalidatePath: () => {} },
  });
  return { actions, entry: () => entry, events };
}

for (const change of ['reopen', 'edit'] as const) {
  test(`a stale approval cannot overwrite a concurrent ${change} of the time entry`, async () => {
    const f = fixture(change);
    const result = await f.actions.approveTimeEntry('entry-1');
    assert.ok(result.error);
    assert.equal(f.entry().status, 'EDITED');
    assert.equal(f.entry().clockOut?.toISOString() ?? null, change === 'reopen' ? null : '2026-09-01T17:00:00.000Z');
    assert.equal(f.events.length, 0);
  });
}

test('a current closed entry is approved and audited together', async () => {
  const f = fixture();
  assert.equal((await f.actions.approveTimeEntry('entry-1')).success, true);
  assert.equal(f.entry().status, 'APPROVED');
  assert.equal(f.events.length, 1);
});

test('a failed approval audit rolls back the approval through the real auditedWrite helper', async () => {
  const f = fixture(undefined, true);
  await assert.rejects(f.actions.approveTimeEntry('entry-1'), /audit storage unavailable/);
  assert.equal(f.entry().status, 'EDITED');
  assert.equal(f.events.length, 0);
});
