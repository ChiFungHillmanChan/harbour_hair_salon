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
        if ('rescheduleRequestedDate' in where) return [];
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
      findMany: async (query: Record<string, unknown>) => {
        if ((query.where as { status?: string }).status !== 'PENDING') return [];
        calls.push(query);
        return pending;
      },
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

test('the board carries each booking\'s recorded price and only bookable options for new bookings', async () => {
  const quote = { schema: 1, serviceId: 'nhs-long', offeringId: 'o1', hairLength: 'LONG', priceType: 'NHS', currency: 'GBP', amountPence: 14200,
    breakdown: [{ kind: 'LISTED', amountPence: 14200 }], vatDisplay: 'EXCLUDED', priceNature: 'SUBJECT_TO_CONSULTATION', priceVersion: 2,
    durationMinutes: 120, durationSource: 'SERVICE', discountsApplied: false, priceSource: null };
  const base = { date: new Date('2026-10-23T10:00:00Z'), status: 'CONFIRMED', stylistId: 's1', serviceId: 'svc', updatedAt: new Date('2026-10-01T00:00:00Z'),
    durationAtBooking: 60, notes: null, user: { id: 'u1', name: 'Mei', email: 'mei@example.test' }, stylist: { name: 'Ivan', calendarColor: null },
    service: { name: 'Colour', duration: 60, calendarColor: null } };
  const db = {
    appointment: {
      count: async () => 0,
      groupBy: async () => [],
      findMany: async ({ where }: { where: { status?: string } }) => where.status === 'PENDING' ? [] : [
        { ...base, id: 'legacy', priceAtBooking: null, quoteJson: null },
        { ...base, id: 'quoted', priceAtBooking: '142.00', quoteJson: JSON.stringify(quote) },
      ],
    },
    stylist: { findMany: async () => [] },
    externalBusyBlock: { findMany: async () => [] },
    service: { findMany: async ({ select }: { select: Record<string, unknown> }) => {
      assert.ok(select.isBookable && select.priceVersion && select.priceType, 'the dialog needs the quote fields');
      return [
        { id: 'open', name: 'Blow Dry', duration: 45, price: '40.00', category: 'Styling', requiresPatchTest: false, priceVersion: 3, priceType: 'STANDARD', hairLength: null, vatDisplay: 'EXCLUDED', priceNature: 'LISTED', isBookable: true, offeringId: null },
        { id: 'retired', name: 'Blow Dry (Student & NHS)', duration: 45, price: '35.00', category: 'Styling', requiresPatchTest: false, priceVersion: 1, priceType: 'NHS', hairLength: null, vatDisplay: 'UNSPECIFIED', priceNature: 'LISTED', isBookable: false, offeringId: null },
      ];
    } },
  };
  const { getAdminCalendarData } = loadServerModule<typeof import('./admin-calendar-data')>('src/app/services/admin-calendar-data.ts', {
    '@/app/lib/prisma': { __esModule: true, default: db, getDatabaseProvider: () => 'postgresql' },
    '@/app/lib/session': { requireAdmin: async () => ({ userId: 'admin', role: 'ADMIN' }) },
    './integration-readiness': { getTreatwellSyncCoverage: async () => ({ warning: null }) },
  });
  const result = await getAdminCalendarData({ date: '2026-10-23', view: 'day' });
  const byId = new Map(result.appointments.map((row) => [row.id, row]));
  assert.deepEqual(byId.get('legacy')?.price, { known: false }, 'no recorded price stays unknown — never the current service price or £0');
  assert.deepEqual(byId.get('quoted')?.price, { known: true, amountPence: 14200, priceType: 'NHS', vatDisplay: 'EXCLUDED', priceNature: 'SUBJECT_TO_CONSULTATION' });
  assert.ok(!('price' in (byId.get('legacy')?.service ?? {})), 'today\'s service price never reaches the board');
  assert.deepEqual(result.services.map((service) => [service.id, service.amountPence, service.isBookable]), [['open', 4000, true], ['retired', 3500, false]]);
});

test('the board lists open reschedule requests by request age and counts only unexpired ones', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') });
  const requests = [
    { id: 'r2', date: new Date('2099-09-20T09:00:00Z'), rescheduleRequestedDate: new Date('2099-09-02T09:00:00Z'), rescheduleRequestedAt: new Date('2099-08-30T10:00:00Z'),
      user: { name: 'Amy', phone: null }, stylist: { name: 'Ivan' }, service: { name: 'Cut' } },
    { id: 'r1', date: new Date('2099-09-21T09:00:00Z'), rescheduleRequestedDate: new Date('2099-09-10T09:00:00Z'), rescheduleRequestedAt: new Date('2099-09-01T10:00:00Z'),
      user: { name: 'Ben', phone: '07000 000000' }, stylist: { name: 'Lox' }, service: { name: 'Colour' } },
  ];
  const queries: { where: Record<string, unknown>; orderBy: unknown; take: number }[] = [];
  const { getAdminCalendarData } = loadServerModule<typeof import('./admin-calendar-data')>('src/app/services/admin-calendar-data.ts', {
    '@/app/lib/prisma': { __esModule: true, getDatabaseProvider: () => 'postgresql', default: { appointment: {
      findMany: async (query: { where: Record<string, unknown>; orderBy: unknown; take: number }) => {
        if ('rescheduleRequestedDate' in query.where) { queries.push(query); return requests; }
        return [];
      },
      groupBy: async () => [], count: async () => 0,
    }, $queryRaw: async () => [{}] } },
    '@/app/lib/session': { requireAdmin: async () => ({ role: 'ADMIN' }) },
    './integration-readiness': { getTreatwellSyncCoverage: async () => ({ warning: null }) },
  });
  const data = await getAdminCalendarData({ date: '2099-09-01', view: 'year' });
  assert.deepEqual(queries[0].where, { status: 'CONFIRMED', rescheduleRequestedDate: { not: null } });
  assert.deepEqual(queries[0].orderBy, [{ rescheduleRequestedAt: 'asc' }, { id: 'asc' }]);
  assert.equal(queries[0].take, 50);
  assert.deepEqual(data.rescheduleRequests.map((row) => [row.id, row.expired]), [['r2', true], ['r1', false]]);
  assert.equal(data.rescheduleRequestCount, 1, 'an expired request is listed but not counted');
  assert.equal(data.rescheduleRequests[0].requestedDate, '2099-09-02T09:00:00.000Z');
  assert.equal(data.rescheduleRequests[1].user.phone, '07000 000000', 'the phone is carried so staff can call the customer');
  assert.equal(data.rescheduleRequests[1].requestedAt, '2099-09-01T10:00:00.000Z');
});

test('a request on a booking whose original time has passed is listed as expired and not counted', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') });
  const requests = [
    // The visit was yesterday; the requested time is still days away.
    { id: 'past', date: new Date('2099-08-31T09:00:00Z'), rescheduleRequestedDate: new Date('2099-09-10T09:00:00Z'), rescheduleRequestedAt: new Date('2099-08-29T10:00:00Z'),
      user: { name: 'Amy', phone: null }, stylist: { name: 'Ivan' }, service: { name: 'Cut' } },
    { id: 'open', date: new Date('2099-09-21T09:00:00Z'), rescheduleRequestedDate: new Date('2099-09-10T09:00:00Z'), rescheduleRequestedAt: new Date('2099-09-01T10:00:00Z'),
      user: { name: 'Ben', phone: null }, stylist: { name: 'Lox' }, service: { name: 'Colour' } },
  ];
  const { getAdminCalendarData } = loadServerModule<typeof import('./admin-calendar-data')>('src/app/services/admin-calendar-data.ts', {
    '@/app/lib/prisma': { __esModule: true, getDatabaseProvider: () => 'postgresql', default: { appointment: {
      findMany: async (query: { where: Record<string, unknown> }) => ('rescheduleRequestedDate' in query.where ? requests : []),
      groupBy: async () => [], count: async () => 0,
    }, $queryRaw: async () => [{}] } },
    '@/app/lib/session': { requireAdmin: async () => ({ role: 'ADMIN' }) },
    './integration-readiness': { getTreatwellSyncCoverage: async () => ({ warning: null }) },
  });
  const data = await getAdminCalendarData({ date: '2099-09-01', view: 'year' });
  assert.deepEqual(data.rescheduleRequests.map((row) => [row.id, row.expired]), [['past', true], ['open', false]]);
  assert.equal(data.rescheduleRequestCount, 1, 'a request on a visit that already happened needs no answer');
});
