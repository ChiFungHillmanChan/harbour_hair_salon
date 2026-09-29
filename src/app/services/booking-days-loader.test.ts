import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { ANY_STYLIST_ID } from '../lib/booking-constants';
import { resolveSalonDateTime } from './salon-time';

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

type Where = Record<string, unknown>;
function fixture(options: { enabled?: boolean; fail?: boolean } = {}) {
  const calls: { model: string; where: Where }[] = [];
  const hours = [
    { stylistId: 'funky', dayOfWeek: 2, startTime: '10:15', endTime: '19:00' },
    { stylistId: 'lox', dayOfWeek: 2, startTime: '10:15', endTime: '19:00' },
  ];
  const pause = { stylistId: 'funky', start: resolveSalonDateTime('2026-10-06', '10:00').utc, end: resolveSalonDateTime('2026-10-06', '20:30').utc };
  const db = {
    availability: { findMany: async ({ where }: { where: Where }) => {
      calls.push({ model: 'availability', where });
      if (options.fail) throw new Error('db down');
      return where.stylistId ? hours.filter((row) => row.stylistId === where.stylistId) : hours;
    } },
    appointment: { findMany: async ({ where }: { where: Where }) => { calls.push({ model: 'appointment', where }); return []; } },
    externalBusyBlock: { findMany: async ({ where }: { where: Where }) => { calls.push({ model: 'externalBusyBlock', where }); return [pause]; } },
  };
  const readiness = { isBookingEnabled: async () => options.enabled !== false, assertOnlineBookingReady: async () => ({}) };
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/booking-maintenance': readiness,
    './notification-outbox-service': {},
  });
  const actions = loadServerModule<typeof import('../actions/booking')>('src/app/actions/booking.ts', {
    '@/app/lib/prisma': db,
    '@/app/services/booking-service': service,
    '@/app/lib/booking-maintenance': readiness,
    '@/app/services/notification-outbox-service': {},
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1', role: 'USER' }) },
    '@/app/lib/rate-limit': { bookingLimiter: { check: async () => true }, discountLimiter: { check: async () => true } },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    'next/cache': { revalidatePath: () => undefined },
    'next/server': { after: (callback: () => unknown) => callback() },
  });
  return { service, actions, calls };
}

const FOURTEEN = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10));

test('fourteen days cost exactly three queries', async () => {
  const f = fixture();
  const days = await f.service.getBookingDays('funky', FOURTEEN, 60);
  assert.equal(days.length, 14);
  assert.deepEqual(f.calls.map((call) => call.model).sort(), ['appointment', 'availability', 'externalBusyBlock']);
});

test('a named stylist on a Fresha Pause day is Unavailable', async () => {
  const f = fixture();
  const [tuesday] = await f.service.getBookingDays('funky', ['2026-10-06'], 60);
  assert.equal(tuesday.status, 'UNAVAILABLE');
});

test('Anyone on the same day stays open through the other stylist', async () => {
  const f = fixture();
  const [tuesday] = await f.service.getBookingDays(ANY_STYLIST_ID, ['2026-10-06'], 60);
  assert.equal(tuesday.status, 'OPEN');
});

test('only active stylists’ working rows are read', async () => {
  const f = fixture();
  await f.service.getBookingDays(ANY_STYLIST_ID, ['2026-10-06'], 60);
  const where = f.calls.find((call) => call.model === 'availability')!.where;
  assert.deepEqual(where, { isOff: false, stylist: { isActive: true } });
});

test('the action refuses bad input without touching the database', async () => {
  const f = fixture();
  for (const [stylist, dates, duration] of [
    ['funky', [], 60], ['funky', ['2026-13-40'], 60], ['funky', ['2026-02-30'], 60], ['funky', ['2026-10-06'], 3],
    ['funky', [...FOURTEEN, '2026-10-15'], 60], ['', ['2026-10-06'], 60],
  ] as const) {
    assert.deepEqual(await f.actions.fetchBookingDays(stylist, [...dates], duration), { ok: true, days: [] });
  }
  assert.equal(f.calls.length, 0);
});

test('the action shows nothing while online booking is switched off', async () => {
  const f = fixture({ enabled: false });
  assert.deepEqual(await f.actions.fetchBookingDays('funky', ['2026-10-06'], 60), { ok: true, days: [] });
  assert.equal(f.calls.length, 0);
});

test('a lookup failure is reported as a failure, not as an unavailable fortnight', async () => {
  const f = fixture({ fail: true });
  assert.deepEqual(await f.actions.fetchBookingDays('funky', ['2026-10-06'], 60), { ok: false });
});
