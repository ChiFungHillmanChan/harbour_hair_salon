import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { ANY_STYLIST_ID } from '../lib/booking-constants';
import { resolveSalonDateTime } from './salon-time';

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

type Where = Record<string, unknown>;
function fixture(options: { enabled?: boolean; fail?: boolean; limited?: boolean } = {}) {
  const calls: { model: string; where: Where }[] = [];
  const limiterKeys: string[] = [];
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
    '@/app/lib/rate-limit': {
      bookingLimiter: { check: async () => true }, discountLimiter: { check: async () => true },
      availabilityLimiter: { check: async (key: string) => { limiterKeys.push(key); return !options.limited; } },
    },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    'next/cache': { revalidatePath: () => undefined },
    'next/headers': { headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }) },
    'next/server': { after: (callback: () => unknown) => callback() },
  });
  return { service, actions, calls, limiterKeys };
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

test('a whole-history range is refused before the limiter or the database', async () => {
  const f = fixture();
  for (const dates of [
    ['1900-01-01', '9999-12-31'],
    ['2026-10-01', '2026-10-15'], // two dates, fifteen days apart
    ['2027-06-01'], // past the bookable horizon
    ['2026-09-29'], // two days before the salon's today
  ]) {
    assert.deepEqual(await f.actions.fetchBookingDays('funky', dates, 60), { ok: true, days: [] });
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.limiterKeys.length, 0);
});

test('the service refuses an unbounded range too, whoever calls it', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.getBookingDays(ANY_STYLIST_ID, ['1900-01-01', '9999-12-31'], 60), []);
  assert.equal(f.calls.length, 0);
});

test('a limited address gets the could-not-load answer without a query', async () => {
  const f = fixture({ limited: true });
  assert.deepEqual(await f.actions.fetchBookingDays('funky', FOURTEEN, 60), { ok: false });
  assert.deepEqual(await f.actions.fetchSlots('funky', '2026-10-06', 60), { ok: false });
  assert.equal(f.calls.length, 0);
  // Keyed by the client address Vercel puts first, not a proxy behind it.
  assert.deepEqual(f.limiterKeys, ['203.0.113.7', '203.0.113.7']);
});

test('single-day time lookups keep to the same window', async () => {
  const f = fixture();
  assert.deepEqual(await f.actions.fetchSlots('funky', '9999-12-31', 60), { ok: true, slots: [] });
  assert.deepEqual(await f.actions.fetchSlots('funky', '1900-01-01', 60), { ok: true, slots: [] });
  const form = new FormData();
  form.set('stylistId', 'funky'); form.set('date', '9999-12-31'); form.set('serviceDuration', '60');
  assert.ok('error' in await f.actions.getAvailableSlotsAction(undefined, form));
  assert.equal(f.calls.length, 0);
  assert.equal(f.limiterKeys.length, 0);
});

test('the wizard strip, including a visitor a day either side of London, still loads', async () => {
  const f = fixture();
  const strip = (start: number) => Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 9, start + i)).toISOString().slice(0, 10));
  for (const dates of [FOURTEEN, strip(0), strip(2)]) {
    const result = await f.actions.fetchBookingDays('funky', dates, 60);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.days.length, 14);
  }
});
