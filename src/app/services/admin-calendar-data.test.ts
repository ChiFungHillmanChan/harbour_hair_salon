import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';

test('year calendar returns twelve aggregates without loading appointment details or busy rows', async () => {
  let detailReads = 0;
  let busyReads = 0;
  const db = {
    appointment: {
      count: async () => 0,
      groupBy: async () => [],
      findMany: async ({ where, take }: { where: { status?: string }; take?: number }) => {
        if (where.status !== 'PENDING') detailReads++;
        assert.ok(take && take <= 26, 'pending page must be bounded');
        return [];
      },
    },
    stylist: { findMany: async () => [] },
    externalBusyBlock: { findMany: async () => { busyReads++; return []; } },
    $queryRaw: async () => [Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`month${i}`, i === 0 ? BigInt(3) : BigInt(0)]))],
  };
  const { getAdminCalendarData } = loadServerModule<typeof import('./admin-calendar-data')>('src/app/services/admin-calendar-data.ts', {
    '@/app/lib/prisma': { __esModule: true, default: db, getDatabaseProvider: () => 'postgresql' },
    '@/app/lib/session': { requireAdmin: async () => ({ userId: 'admin', role: 'ADMIN' }) },
    './integration-readiness': { getTreatwellSyncCoverage: async () => ({ warning: null }) },
  });
  const result = await getAdminCalendarData({ date: '2026-09-16', view: 'year' });
  assert.equal(detailReads, 0);
  assert.equal(busyReads, 0);
  assert.deepEqual(result.monthCounts, [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(result.appointments, []);
});

test('calendar refuses unauthorized reads before accessing the database', async () => {
  const { getAdminCalendarData } = loadServerModule<typeof import('./admin-calendar-data')>('src/app/services/admin-calendar-data.ts', {
    '@/app/lib/prisma': { appointment: { findMany: () => { throw new Error('Database touched before authorization'); } } },
    '@/app/lib/session': { requireAdmin: async () => { throw new Error('Unauthorized'); } },
    './integration-readiness': {},
  });
  await assert.rejects(getAdminCalendarData({ view: 'year' }), /Unauthorized/);
});

test('pending cursor is bounded, deterministic and independent of selected calendar dates', async () => {
  const calls: Record<string, unknown>[] = [];
  const pending = Array.from({ length: 26 }, (_, i) => ({ id: `pending-${i.toString().padStart(2, '0')}`, date: new Date('2027-01-01T10:00:00Z'), status: 'PENDING', user: { name: 'Customer' }, stylist: { name: 'Stylist' }, service: { name: 'Cut' } }));
  const { getAdminCalendarData } = loadServerModule<typeof import('./admin-calendar-data')>('src/app/services/admin-calendar-data.ts', {
    '@/app/lib/prisma': { __esModule: true, getDatabaseProvider: () => 'postgresql', default: { appointment: {
      findMany: async (query: Record<string, unknown>) => { calls.push(query); return pending; },
      groupBy: async () => [], count: async () => 26,
    }, $queryRaw: async () => [{}] } },
    '@/app/lib/session': { requireAdmin: async () => ({ role: 'ADMIN' }) },
    './integration-readiness': { getTreatwellSyncCoverage: async () => ({ warning: null }) },
  });
  const first = await getAdminCalendarData({ date: '2020-01-01', view: 'year' });
  assert.equal(first.pendingAppointments.length, 25);
  assert.equal(first.pendingCount, 26);
  assert.ok(first.pendingNext);
  await getAdminCalendarData({ date: '2020-01-01', view: 'year', pending: first.pendingNext });
  assert.equal(calls[1].take, 26);
  assert.deepEqual(calls[1].orderBy, [{ date: 'asc' }, { id: 'asc' }]);
  assert.deepEqual(calls[1].where, { status: 'PENDING', OR: [{ date: { gt: pending[24].date } }, { date: pending[24].date, id: { gt: pending[24].id } }] });
});
