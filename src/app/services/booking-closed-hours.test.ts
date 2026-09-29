import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { BookingError } from './booking-errors';
import { buildSlotsForWindow } from './scheduling';
import { ANY_STYLIST_ID } from '../lib/booking-constants';

/**
 * A customer must never end up with an appointment outside the salon's working
 * hours — not on a closed day, not before opening, and not one that over-runs
 * closing.
 *
 * The rule is enforced inside the booking transaction, so these drive the real
 * entry points rather than the pure helper: every customer-facing path that can
 * set an appointment's date is exercised here. (An ADMIN is deliberately allowed
 * to override, with a named warning — see actions/admin-schedule.ts.)
 */

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') }));
after(() => mock.timers.reset());

// 2099-09-14 is a Monday. 10:00 salon-local = 09:00Z (BST).
const DATE_STR = '2099-09-14';
const TEN_AM = new Date('2099-09-14T09:00:00Z');

type Hours = { startTime: string; endTime: string } | null;

function fixture(options: { hours?: Hours; existing?: { date: Date; durationMin: number }[] } = {}) {
  const hours = options.hours === undefined ? { startTime: '10:00', endTime: '18:00' } : options.hours;
  const stored: Record<string, unknown>[] = [];
  const appointment = {
    id: 'appt-1', userId: 'user-1', stylistId: 'stylist-1', serviceId: 'service-1',
    date: new Date('2099-09-20T09:00:00Z'), status: 'CONFIRMED', durationAtBooking: 60,
    notificationVersion: 0, updatedAt: new Date('2099-09-01T00:00:00Z'), treatwellBookingId: null,
    user: { email: 'c@example.test', name: 'Customer' },
    stylist: { name: 'Stylist', treatwellExternalId: null },
    service: { id: 'service-1', name: 'Cut', price: 100, duration: 60, requiresPatchTest: false, treatwellExternalId: null },
  };
  const liveService = {
    id: 'service-1', name: 'Cut', price: '100.00', duration: 60, treatwellExternalId: null, requiresPatchTest: false, requiresConsultation: false, isConsultation: false, isPatchTest: false,
    offeringId: null, hairLength: null, priceType: 'STANDARD', priceVersion: 1, vatDisplay: 'UNSPECIFIED', priceNature: 'LISTED',
    durationConfirmed: true, surchargeBaseServiceId: null, surchargeAmount: null, priceSource: null, isPublic: true, isBookable: true,
  };

  const tx = {
    service: { findUnique: async () => liveService },
    stylist: {
      findUnique: async () => ({ id: 'stylist-1', name: 'Stylist', isActive: true, treatwellExternalId: null }),
      findMany: async () => (hours ? [{ id: 'stylist-1', name: 'Stylist', availabilities: [hours] }] : []),
    },
    // A closed day is exactly this: no row survives the isOff / isActive filter.
    availability: {
      findFirst: async () => hours,
      findMany: async () => (hours ? [{ ...hours, stylistId: 'stylist-1' }] : []),
    },
    appointment: {
      count: async () => 0,
      findUnique: async () => structuredClone(appointment),
      findMany: async () => (options.existing ?? []).map((row, index) => ({
        id: `existing-${index}`, stylistId: 'stylist-1', date: row.date,
        durationAtBooking: row.durationMin, service: { duration: row.durationMin },
      })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        stored.push(data);
        return { id: 'new', notificationVersion: 0, ...data, user: { name: 'Customer', email: 'c@example.test', phone: null }, stylist: { name: 'Stylist' }, service: { ...liveService } };
      },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { stored.push(data); return { count: 1 }; },
    },
    externalBusyBlock: { findMany: async () => [] },
    // A customer whose address is confirmed (see lib/email-verification.ts).
    user: { findUnique: async () => ({ emailVerifiedAt: new Date(), oauthAccounts: [] }) },
    discountCode: { findUnique: async () => null, update: async () => null },
    notificationDelivery: { findUnique: async () => null, upsert: async () => ({ id: 'event-1' }) },
  };
  const db = { ...tx, $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) };

  const queue = { enqueueAppointmentNotification: async () => ({ id: 'e' }), dispatchAppointmentNotifications: async () => undefined };
  const bookingReadiness = {
    isBookingEnabled: async () => true,
    assertOnlineBookingReady: async () => ({ bookingEnabled: true, phone: '020 0000 0000' }),
    BOOKING_MAINTENANCE_MESSAGE: 'closed',
  };
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': db,
    './offers-service': { getActiveGlobalOffer: async () => null },
    '@/app/lib/booking-maintenance': bookingReadiness,
    './notification-outbox-service': queue,
  });
  const actions = loadServerModule<typeof import('../actions/booking')>('src/app/actions/booking.ts', {
    '@/app/lib/prisma': db,
    '@/app/services/booking-service': service,
    '@/app/lib/booking-maintenance': bookingReadiness,
    '@/app/services/notification-outbox-service': queue,
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1', role: 'USER' }) },
    '@/app/lib/rate-limit': { bookingLimiter: { check: async () => true }, discountLimiter: { check: async () => true } },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    'next/server': { after: (callback: () => unknown) => callback() },
    'next/cache': { revalidatePath: () => undefined },
  });
  return { actions, service, stored };
}

const booking = (time: string, stylistId = 'stylist-1') => ({
  stylistId, serviceId: 'service-1', date: DATE_STR, time,
  expectedQuote: { serviceId: 'service-1', priceVersion: 1, amountPence: 10000 },
});

test('a customer cannot book on a day the salon is closed', async () => {
  const { actions, stored } = fixture({ hours: null });

  const result = await actions.submitBooking(booking('11:00'));

  assert.equal(result.success, false);
  assert.match(result.error!, /not available on this day/);
  assert.equal(stored.length, 0, 'nothing may be written for a closed day');
});

test('a customer cannot book before opening', async () => {
  const { actions, stored } = fixture({ hours: { startTime: '10:00', endTime: '18:00' } });

  const result = await actions.submitBooking(booking('09:00'));

  assert.equal(result.success, false);
  assert.match(result.error!, /outside business hours/);
  assert.equal(stored.length, 0);
});

test('a customer cannot book a service that would over-run closing', async () => {
  // A 60-minute cut starting at 17:30 finishes at 18:30, half an hour late.
  const { actions, stored } = fixture({ hours: { startTime: '10:00', endTime: '18:00' } });

  const result = await actions.submitBooking(booking('17:30'));

  assert.equal(result.success, false);
  assert.match(result.error!, /outside business hours/);
  assert.equal(stored.length, 0);
});

test('a service finishing exactly at closing time is still allowed', async () => {
  // The guard must refuse over-runs without costing the salon its last slot.
  const { actions, stored } = fixture({ hours: { startTime: '10:00', endTime: '18:00' } });

  const result = await actions.submitBooking(booking('17:00'));

  assert.equal(result.success, true);
  assert.equal(stored.length, 1);
});

test('the "Anyone" path cannot be used to reach a closed day', async () => {
  // Choosing no particular stylist must not skip the hours check.
  const { actions, stored } = fixture({ hours: null });

  const result = await actions.submitBooking(booking('11:00', ANY_STYLIST_ID));

  assert.equal(result.success, false);
  assert.equal(stored.length, 0);
});

test('rescheduling cannot move a confirmed booking outside working hours', async () => {
  const { actions, stored } = fixture({ hours: { startTime: '10:00', endTime: '18:00' } });

  const result = await actions.rescheduleAppointment('appt-1', DATE_STR, '19:30');

  assert.equal(result.success, false);
  assert.match(result.error!, /outside business hours/);
  assert.equal(stored.length, 0, 'a refused reschedule must not touch the row');
});

test('rescheduling cannot move a confirmed booking onto a closed day', async () => {
  const { actions, stored } = fixture({ hours: null });

  const result = await actions.rescheduleAppointment('appt-1', DATE_STR, '11:00');

  assert.equal(result.success, false);
  assert.match(result.error!, /not available on this day/);
  assert.equal(stored.length, 0);
});

test('calling the service directly cannot bypass the hours check either', async () => {
  // The server action is not the security boundary; the transaction is.
  const { service } = fixture({ hours: { startTime: '10:00', endTime: '18:00' } });

  await assert.rejects(
    service.createBooking({ stylistId: 'stylist-1', serviceId: 'service-1', date: new Date('2099-09-14T20:00:00Z'), userId: 'user-1', expectedQuote: { serviceId: 'service-1', priceVersion: 1, amountPence: 10000 } }),
    (error: unknown) => error instanceof BookingError && /outside business hours/.test(error.message),
  );
});

test('the times a customer is offered never include one that over-runs closing', () => {
  // Whatever the grid shows must already satisfy the rule the server enforces,
  // so a customer is never refused a slot the page invited them to pick.
  const slots = buildSlotsForWindow(DATE_STR, { startTime: '10:00', endTime: '18:00' }, [], 90, new Date('2099-09-01T00:00:00Z'));

  assert.ok(slots.length > 0);
  assert.equal(slots.at(-1)!.time, '16:30', '16:30 + 90 min is exactly 18:00');
  assert.ok(!slots.some((slot) => slot.time > '16:30'), 'no offered slot may finish after closing');
});

test('a closed day offers a customer no times at all', () => {
  assert.deepEqual(buildSlotsForWindow(DATE_STR, { startTime: '10:00', endTime: '10:00' }, [], 30, TEN_AM), []);
});
