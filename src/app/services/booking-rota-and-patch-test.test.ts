import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { BookingError } from './booking-errors';
import { ANY_STYLIST_ID } from '../lib/booking-constants';

/**
 * Weekly rota and the colour patch-test rule, driven through the real entry
 * points. Unlike the closed-hours fixture, these fakes honour `dayOfWeek`, so
 * looking up the wrong weekday (an off-by-one in the salon-time conversion)
 * fails here instead of silently reading "open".
 */

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') }));
after(() => mock.timers.reset());

// 2099-09-14 is a Monday (1), 2099-09-15 a Tuesday (2). 11:00 salon-local = 10:00Z (BST).
const MONDAY = '2099-09-14';
const TUESDAY = '2099-09-15';
const HOURS = { startTime: '10:00', endTime: '18:00' };
/** Alex works Tuesdays only; Bea works Mondays only. Alex sorts first by name. */
const ROTA: Record<string, number[]> = { alex: [2], bea: [1] };

function fixture(options: { requiresPatchTest?: boolean; patchTestDate?: Date } = {}) {
  const stored: Record<string, unknown>[] = [];
  const liveService = {
    id: 'service-1', name: 'Colour', price: '100.00', duration: 60, treatwellExternalId: null,
    requiresPatchTest: options.requiresPatchTest ?? false, requiresConsultation: false, isConsultation: false, isPatchTest: false,
    offeringId: null, hairLength: null, priceType: 'STANDARD', priceVersion: 1, vatDisplay: 'UNSPECIFIED', priceNature: 'LISTED',
    durationConfirmed: true, surchargeBaseServiceId: null, surchargeAmount: null, priceSource: null, isPublic: true, isBookable: true,
  };
  const works = (stylistId: string, dayOfWeek: number | undefined) => dayOfWeek === undefined || (ROTA[stylistId] ?? []).includes(dayOfWeek);

  const tx = {
    service: { findUnique: async () => liveService },
    stylist: {
      findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id, isActive: true, treatwellExternalId: null }),
      // eligibleStylistIds: stylists with a row for that weekday, each with only that weekday's hours.
      findMany: async ({ where }: { where: { availabilities?: { some?: { dayOfWeek?: number } } } }) => {
        const day = where.availabilities?.some?.dayOfWeek;
        return Object.keys(ROTA).sort()
          .filter((id) => works(id, day))
          .map((id) => ({ id, availabilities: [HOURS] }));
      },
    },
    availability: {
      findFirst: async ({ where }: { where: { stylistId: string; dayOfWeek: number } }) => (works(where.stylistId, where.dayOfWeek) ? HOURS : null),
      findMany: async ({ where }: { where: { stylistId?: string; dayOfWeek?: number } }) => Object.entries(ROTA)
        .filter(([id]) => !where.stylistId || id === where.stylistId)
        .flatMap(([stylistId, days]) => days.filter((day) => where.dayOfWeek === undefined || day === where.dayOfWeek)
          .map((dayOfWeek) => ({ stylistId, dayOfWeek, ...HOURS }))),
    },
    appointment: {
      count: async () => 0,
      findMany: async ({ where }: { where: { service?: { isPatchTest?: boolean } } }) => {
        if (where.service?.isPatchTest) return options.patchTestDate ? [{ date: options.patchTestDate, status: 'COMPLETED' }] : [];
        return [];
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        stored.push(data);
        return { id: 'new', notificationVersion: 0, ...data, user: { name: 'Customer', email: 'c@example.test', phone: null }, stylist: { name: String(data.stylistId) }, service: { ...liveService } };
      },
    },
    externalBusyBlock: { findMany: async () => [] },
    user: { findUnique: async () => ({ emailVerifiedAt: new Date(), oauthAccounts: [] }) },
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
    '@/app/lib/rate-limit': {
      bookingLimiter: { check: async () => true }, discountLimiter: { check: async () => true },
      rescheduleLimiter: { check: async () => true }, appointmentRescheduleLimiter: { check: async () => true },
    },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    'next/server': { after: (callback: () => unknown) => callback() },
    'next/cache': { revalidatePath: () => undefined },
  });
  return { actions, service, stored };
}

const booking = (stylistId: string, date: string, time = '11:00') => ({
  stylistId, serviceId: 'service-1', date, time,
  expectedQuote: { serviceId: 'service-1', priceVersion: 1, amountPence: 10000 },
});

test('a stylist is offered times only on the weekday they work', async () => {
  const { service } = fixture();
  assert.ok((await service.getAvailableSlots('bea', MONDAY, 60)).length > 0, 'Bea works Mondays');
  assert.deepEqual(await service.getAvailableSlots('bea', TUESDAY, 60), [], 'Bea is off on Tuesdays');
  assert.ok((await service.getAvailableSlotsUnion(TUESDAY, 60)).length > 0, 'Alex covers Tuesday for Anyone');
});

test('a booking on the stylist\'s weekly day off is refused by the action and by the service', async () => {
  const { actions, service, stored } = fixture();
  const refused = await actions.submitBooking(booking('bea', TUESDAY));
  assert.equal(refused.success, false);
  assert.match(refused.error!, /not available on this day/);
  await assert.rejects(
    service.createBooking({ stylistId: 'bea', serviceId: 'service-1', date: new Date('2099-09-15T10:00:00Z'), userId: 'user-1', expectedQuote: booking('bea', TUESDAY).expectedQuote }),
    (error: unknown) => error instanceof BookingError && error.code === 'STYLIST_OFF_THAT_DAY',
  );
  assert.equal(stored.length, 0);
  assert.equal((await actions.submitBooking(booking('bea', MONDAY))).success, true, 'the same stylist on a working day is fine');
});

test('Anyone goes to the stylist who works that weekday, not the first by name', async () => {
  const { actions, stored } = fixture();
  const result = await actions.submitBooking(booking(ANY_STYLIST_ID, MONDAY));
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(stored[0].stylistId, 'bea');
});

test('a colour service cannot be booked inside the 48 hours after the patch test', async () => {
  // Patch test on Sunday 11:00; Monday 11:00 is only 24 hours later.
  const tooSoon = fixture({ requiresPatchTest: true, patchTestDate: new Date('2099-09-13T10:00:00Z') });
  const refused = await tooSoon.actions.submitBooking(booking('bea', MONDAY));
  assert.equal(refused.success, false);
  assert.equal(refused.error, 'Your patch test must be at least 48 hours before a colour appointment.');
  assert.equal(tooSoon.stored.length, 0);

  const missing = fixture({ requiresPatchTest: true });
  const none = await missing.actions.submitBooking(booking('bea', MONDAY));
  assert.equal(none.success, false);
  assert.match(none.error!, /Consultation & Patch Test first/);
  assert.equal(missing.stored.length, 0);

  const ready = fixture({ requiresPatchTest: true, patchTestDate: new Date('2099-09-10T10:00:00Z') });
  assert.equal((await ready.actions.submitBooking(booking('bea', MONDAY))).success, true, 'four days after the test is fine');
});
