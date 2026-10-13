import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { ANY_STYLIST_ID } from '../lib/booking-constants';
import { resolveSalonDateTime } from './salon-time';

/**
 * The response to a booking request can be lost (a dropped connection, a
 * second tap on Confirm) after the request was saved. The customer then sends
 * the very same request again. It must come back as the request already made:
 * never a second appointment, and for "Anyone" never the same time again with
 * the next free stylist.
 */

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

const TUESDAY = '2026-10-06';
const at = (time: string) => resolveSalonDateTime(TUESDAY, time).utc;
const STYLISTS = ['funky', 'lox'];
const HOURS = { startTime: '10:00', endTime: '19:00' };

type Row = { id: string; userId: string; serviceId: string; stylistId: string; date: Date; status: string; durationAtBooking: number; notificationVersion: number };
type Where = { userId?: string; serviceId?: string; date?: Date; stylistId?: string | { in: string[] }; status?: { in?: string[]; not?: string } };

function fixture() {
  const rows: Row[] = [];
  const notices: string[] = [];
  const effects = { feedInvalidations: 0, dispatches: 0 };
  const liveService = {
    id: 'service-1', name: 'Cut', price: '100.00', duration: 60, treatwellExternalId: null, requiresPatchTest: false, requiresConsultation: false, isConsultation: false, isPatchTest: false,
    offeringId: null, hairLength: null, priceType: 'STANDARD', priceVersion: 1, vatDisplay: 'EXCLUDED', priceNature: 'LISTED',
    durationConfirmed: true, surchargeBaseServiceId: null, surchargeAmount: null, priceSource: 'test', isPublic: true, isBookable: true,
  };
  const withRelations = (row: Row) => ({
    ...row,
    user: { name: 'Customer', email: 'customer@example.test', phone: null },
    stylist: { name: row.stylistId },
    service: { name: liveService.name, price: liveService.price, duration: liveService.duration },
  });
  const stylistMatches = (filter: Where['stylistId'], id: string) => filter === undefined || (typeof filter === 'string' ? filter === id : filter.in.includes(id));
  const statusMatches = (filter: Where['status'], status: string) => !filter || (filter.in ? filter.in.includes(status) : status !== filter.not);
  const tx = {
    service: { findUnique: async () => liveService },
    stylist: {
      findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id, isActive: true, treatwellExternalId: null }),
      // eligibleStylistIds: everyone works Tuesdays, in name order.
      findMany: async () => STYLISTS.map((id) => ({ id, availabilities: [HOURS] })),
    },
    availability: {
      findFirst: async () => HOURS,
      findMany: async () => STYLISTS.map((stylistId) => ({ stylistId, dayOfWeek: 2, ...HOURS })),
    },
    appointment: {
      count: async ({ where }: { where: Where }) => rows.filter((row) => row.userId === where.userId && statusMatches(where.status, row.status)).length,
      findFirst: async ({ where }: { where: Where }) => {
        const row = rows.find((candidate) => candidate.userId === where.userId && candidate.serviceId === where.serviceId
          && candidate.date.getTime() === where.date?.getTime() && stylistMatches(where.stylistId, candidate.stylistId)
          && statusMatches(where.status, candidate.status));
        return row ? withRelations(row) : null;
      },
      findMany: async ({ where }: { where: Where }) => rows
        .filter((row) => stylistMatches(where.stylistId, row.stylistId) && statusMatches(where.status, row.status))
        .map((row) => ({ ...row, service: { duration: row.durationAtBooking } })),
      create: async ({ data }: { data: Omit<Row, 'id' | 'notificationVersion'> }) => {
        const row: Row = { id: `appointment-${rows.length + 1}`, notificationVersion: 0, ...data };
        rows.push(row);
        return withRelations(row);
      },
    },
    externalBusyBlock: { findMany: async () => [] },
    user: { findUnique: async () => ({ emailVerifiedAt: new Date(), oauthAccounts: [] }), update: async () => ({}) },
  };
  const db = { ...tx, $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) };
  const queue = {
    enqueueAppointmentNotification: async (_db: unknown, kind: string, appointment: { id: string }) => {
      notices.push(`${appointment.id}/${kind}`);
      return { id: `event-${notices.length}` };
    },
    dispatchAppointmentNotifications: async () => { effects.dispatches++; },
  };
  const readiness = {
    isBookingEnabled: async () => true,
    assertOnlineBookingReady: async () => ({ bookingEnabled: true, phone: '0113 000 0000' }),
  };
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/booking-maintenance': readiness,
    './notification-outbox-service': queue,
  });
  const actions = loadServerModule<typeof import('../actions/booking')>('src/app/actions/booking.ts', {
    '@/app/lib/prisma': db,
    '@/app/services/booking-service': service,
    '@/app/lib/booking-maintenance': readiness,
    '@/app/services/notification-outbox-service': queue,
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1', role: 'USER' }) },
    '@/app/lib/rate-limit': { bookingLimiter: { check: async () => true } },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => { effects.feedInvalidations++; } },
    'next/server': { after: (callback: () => unknown) => callback() },
    'next/cache': { revalidatePath: () => undefined },
  });
  return { service, actions, rows, notices, effects };
}

const request = (time = '11:00', userId = 'user-1') => ({ serviceId: 'service-1', date: at(time), userId });

test('an "Anyone" retry returns the request already made instead of booking the next free stylist', async () => {
  const f = fixture();
  const first = await f.service.createBookingForFirstAvailable({ ...request(), candidateStylistIds: STYLISTS });
  const again = await f.service.createBookingForFirstAvailable({ ...request(), candidateStylistIds: STYLISTS });
  assert.equal(f.rows.length, 1, 'one appointment, not one per attempt');
  assert.equal(again.id, first.id);
  assert.equal(again.stylistId, 'funky', 'still the stylist the first attempt was given');
  assert.equal(first.repeat, false);
  assert.equal(again.repeat, true);
  assert.deepEqual(f.notices, ['appointment-1/REQUEST_RECEIVED', 'appointment-1/SALON_ALERT'], 'no second receipt and no second salon alert');
});

test('a named-stylist retry returns the request already made instead of refusing its own slot', async () => {
  const f = fixture();
  const first = await f.service.createBooking({ ...request(), stylistId: 'lox' });
  const again = await f.service.createBooking({ ...request(), stylistId: 'lox' });
  assert.equal(again.id, first.id);
  assert.equal(again.repeat, true);
  assert.equal(f.rows.length, 1);
  assert.equal(f.notices.length, 2);
});

test('the same request is a repeat whichever stylist the retry names', async () => {
  const f = fixture();
  const first = await f.service.createBooking({ ...request(), stylistId: 'lox' });
  const anyone = await f.service.createBookingForFirstAvailable({ ...request(), candidateStylistIds: STYLISTS });
  assert.equal(anyone.id, first.id);
  assert.equal(anyone.stylistId, 'lox');
  assert.equal(f.rows.length, 1);
});

test('a different time is a new request and still books', async () => {
  const f = fixture();
  await f.service.createBookingForFirstAvailable({ ...request('11:00'), candidateStylistIds: STYLISTS });
  const later = await f.service.createBookingForFirstAvailable({ ...request('14:00'), candidateStylistIds: STYLISTS });
  assert.equal(later.repeat, false);
  assert.equal(f.rows.length, 2);
  assert.deepEqual(f.rows.map((row) => row.date.getTime()), [at('11:00').getTime(), at('14:00').getTime()]);
  assert.equal(f.notices.length, 4);
});

test('another customer at the same time is not a repeat', async () => {
  const f = fixture();
  await f.service.createBookingForFirstAvailable({ ...request(), candidateStylistIds: STYLISTS });
  const other = await f.service.createBookingForFirstAvailable({ ...request('11:00', 'user-2'), candidateStylistIds: STYLISTS });
  assert.equal(other.repeat, false);
  assert.equal(other.stylistId, 'lox', 'Funky is taken, so the other customer gets Lox');
  assert.equal(f.rows.length, 2);
});

test('a cancelled request does not count: the same time can be requested again', async () => {
  const f = fixture();
  await f.service.createBooking({ ...request(), stylistId: 'funky' });
  f.rows[0].status = 'CANCELLED';
  const again = await f.service.createBooking({ ...request(), stylistId: 'funky' });
  assert.equal(again.repeat, false);
  assert.equal(f.rows.length, 2);
});

for (const stylistId of [ANY_STYLIST_ID, 'lox']) {
  test(`submitBooking: a repeated ${stylistId === ANY_STYLIST_ID ? 'Anyone' : 'named-stylist'} request succeeds without a new booking, notice or feed refresh`, async () => {
    const f = fixture();
    const input = { stylistId, serviceId: 'service-1', date: TUESDAY, time: '11:00', expectedQuote: { serviceId: 'service-1', priceVersion: 1, amountPence: 10000 } };
    assert.deepEqual(await f.actions.submitBooking(input), { success: true });
    assert.deepEqual(await f.actions.submitBooking(input), { success: true });
    assert.equal(f.rows.length, 1);
    assert.deepEqual(f.notices, ['appointment-1/REQUEST_RECEIVED', 'appointment-1/SALON_ALERT']);
    assert.equal(f.effects.feedInvalidations, 1, 'only the request that booked refreshes the busy feed');
    assert.equal(f.effects.dispatches, 1, 'nothing new to deliver for the repeat');
  });
}
