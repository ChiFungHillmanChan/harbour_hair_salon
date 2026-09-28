import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { assertFeedInvalidatesBeforeDelivery, type NotificationTimingHooks } from '../../test/stalled-notification';
import { BookingError } from './booking-errors';
import { ANY_STYLIST_ID } from '../lib/booking-constants';

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') }));
after(() => mock.timers.reset());

function bookingFixture(
  discount: { type: string; value: number; maxUses?: number; usedCount?: number },
  globalOffer: { discountType: string; discountValue: number } | null = null,
  options: { failEnqueueAt?: number; ready?: boolean; hoursEnd?: string; stylistActive?: boolean; activeBookings?: number; bookable?: boolean; priceVersion?: number } & NotificationTimingHooks = {},
) {
  const stored: Record<string, unknown>[] = [];
  type Event = { id: string; eventKey: string; appointmentId: string; kind: string; payloadJson: string; delivered?: boolean };
  const events: Event[] = [];
  const delivered: Event[] = [];
  let stagedEvents: Event[] = [];
  let transactionActive = false;
  let enqueueCalls = 0;
  let dispatches = 0;
  let conflictReads = 0;
  let externalReads = 0;
  const code = { id: 'code-1', code: 'SAVE', isActive: true, expiresAt: null, maxUses: null, usedCount: 0, ...discount };
  const liveService = {
    id: 'service-1', name: 'Cut', price: '100.00', duration: 60, treatwellExternalId: null, requiresPatchTest: false, requiresConsultation: false, isConsultation: false, isPatchTest: false,
    // Price-option fields read by quoteForNewBooking.
    offeringId: null, hairLength: null, priceType: 'STANDARD', priceVersion: options.priceVersion ?? 1, vatDisplay: 'EXCLUDED', priceNature: 'LISTED',
    durationConfirmed: true, surchargeBaseServiceId: null, surchargeAmount: null, priceSource: 'treatwell:2026-09-28', isPublic: true, isBookable: options.bookable !== false,
  };
  const hours = { startTime: '09:00', endTime: options.hoursEnd ?? '18:00' };
  const tx = {
    service: { findUnique: async () => liveService },
    stylist: {
      findUnique: async () => ({ id: 'stylist-1', name: 'Stylist', isActive: options.stylistActive !== false, treatwellExternalId: null }),
      findMany: async () => [{ id: 'stylist-1', name: 'Stylist', availabilities: [hours] }],
    },
    availability: {
      findFirst: async ({ where }: { where: { stylist?: { isActive?: boolean } } }) => where.stylist?.isActive && options.stylistActive === false ? null : hours,
      findMany: async ({ where }: { where: { stylist?: { isActive?: boolean } } }) => where.stylist?.isActive && options.stylistActive === false ? [] : [{ ...hours, stylistId: 'stylist-1' }],
    },
    appointment: {
      count: async () => (options.activeBookings ?? 0) + stored.length,
      findMany: async () => { conflictReads++; return []; },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `appointment-${stored.length + 1}`, notificationVersion: 0, ...data, user: { name: 'Customer', email: 'customer@example.test', phone: null }, stylist: { name: 'Stylist' }, service: { ...liveService } };
        stored.push(row);
        return row;
      },
    },
    externalBusyBlock: { findMany: async () => { externalReads++; return []; } },
    user: { update: async () => ({}) },
    discountCode: {
      findUnique: async () => ({ ...code }),
      update: async () => { code.usedCount++; return code; },
    },
    notificationDelivery: {
      findUnique: async ({ where }: { where: { eventKey: string } }) => [...events, ...stagedEvents].find((event) => event.eventKey === where.eventKey) ?? null,
      upsert: async ({ create }: { create: Omit<Event, 'id'> }) => {
        assert.equal(transactionActive, true);
        if (++enqueueCalls === options.failEnqueueAt) throw new Error('queue write failed');
        const event = { ...create, id: `event-${events.length + stagedEvents.length + 1}` };
        stagedEvents.push(event);
        return { id: event.id };
      },
    },
  };
  const db = { ...tx, $transaction: async (fn: (database: typeof tx) => Promise<unknown>) => {
    const before = code.usedCount;
    const storedBefore = stored.length;
    transactionActive = true;
    try {
      const result = await fn(tx);
      events.push(...stagedEvents);
      return result;
    } catch (error) {
      code.usedCount = before;
      stored.splice(storedBefore);
      throw error;
    } finally {
      stagedEvents = [];
      transactionActive = false;
    }
  } };
  const outbox = loadServerModule<typeof import('./notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
    '@/app/lib/prisma': db, './email-service': {},
  });
  const queue = {
    enqueueAppointmentNotification: async (...args: Parameters<typeof outbox.enqueueAppointmentNotification>) => {
      assert.equal(args[0], tx, 'enqueue must use the transaction that creates the appointment');
      assert.equal(transactionActive, true);
      return outbox.enqueueAppointmentNotification(...args);
    },
    dispatchAppointmentNotifications: async (appointmentId: string) => {
      assert.equal(transactionActive, false, 'delivery must begin after the booking commits');
      dispatches++;
      await options.onDispatch?.();
      for (const event of events.filter((event) => event.appointmentId === appointmentId && !event.delivered)) {
        delivered.push(event);
        event.delivered = true;
      }
    },
  };
  const bookingReadiness = {
    isBookingEnabled: async () => true,
    assertOnlineBookingReady: async (database: unknown) => {
      assert.equal(database, tx, 'readiness must be checked inside the booking transaction');
      if (options.ready === false) throw new BookingError('MAINTENANCE');
      return { bookingEnabled: true, phone: '020 0000 0000' };
    },
  };
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': db,
    './offers-service': { getActiveGlobalOffer: async () => globalOffer },
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
    '@/app/services/stylist-ical-cache': {
      invalidateStylistIcalFeed: () => {
        assert.equal(transactionActive, false, 'feed invalidation must follow commit');
        options.onFeedInvalidated?.();
      },
      invalidateStylistIcalToken: () => undefined,
    },
    'next/cache': { revalidatePath: () => undefined },
    'next/server': { after: (callback: () => unknown) => options.scheduleAfterResponse ? options.scheduleAfterResponse(callback) : callback() },
  });
  return { service, code, stored, events, delivered, actions, dispatches: () => dispatches, reads: () => ({ conflicts: conflictReads, external: externalReads }) };
}

for (const anyone of [false, true]) {
  test(`${anyone ? 'Anyone' : 'named'} transaction rejects a retired stylist with retained hours`, async () => {
    const f = bookingFixture({ type: 'FIXED', value: 0 }, null, { stylistActive: false });
    const data = { serviceId: 'service-1', date: new Date('2099-09-14T10:00:00Z'), userId: 'user-1' };
    await assert.rejects(anyone
      ? f.service.createBookingForFirstAvailable({ ...data, candidateStylistIds: ['stylist-1'] })
      : f.service.createBooking({ ...data, stylistId: 'stylist-1' }), /available|retired/i);
    assert.equal(f.stored.length, 0);
  });

  test(`${anyone ? 'Anyone' : 'named'} creation checks the user's active cap inside persistence`, async () => {
    const f = bookingFixture({ type: 'FIXED', value: 0 }, null, { activeBookings: 6 });
    const data = { serviceId: 'service-1', date: new Date('2099-09-14T10:00:00Z'), userId: 'user-1' };
    await assert.rejects(anyone
      ? f.service.createBookingForFirstAvailable({ ...data, candidateStylistIds: ['stylist-1'] })
      : f.service.createBooking({ ...data, stylistId: 'stylist-1' }), /maximum.*bookings/i);
    assert.equal(f.stored.length, 0);
  });
}

test('retired stylist hours supply neither named nor Anyone slots', async () => {
  const f = bookingFixture({ type: 'FIXED', value: 0 }, null, { stylistActive: false });
  assert.deepEqual(await f.service.getAvailableSlots('stylist-1', '2099-09-14', 60), []);
  assert.deepEqual(await f.service.getAvailableSlotsUnion('2099-09-14', 60), []);
});

test('named creation loads appointment and external conflicts once inside its transaction', async () => {
  const f = bookingFixture({ type: 'FIXED', value: 0 });
  await f.service.createBooking({ serviceId: 'service-1', stylistId: 'stylist-1', date: new Date('2099-09-14T10:00:00Z'), userId: 'user-1' });
  assert.deepEqual(f.reads(), { conflicts: 1, external: 1 });
});

const quote = { serviceId: 'service-1', priceVersion: 1, amountPence: 10000 };

for (const anyone of [false, true]) {
  test(`${anyone ? 'Anyone' : 'named stylist'} booking freezes the listed price with its quote and never applies an offer`, async () => {
    // Discounts are paused: an active global offer must not change the price.
    const { service, code, stored } = bookingFixture({ type: 'PERCENTAGE', value: 20 }, { discountType: 'PERCENTAGE', discountValue: 20 });
    const data = { serviceId: 'service-1', date: new Date('2099-09-14T10:00:00Z'), userId: 'user-1', expectedQuote: quote, locale: 'zh-HK' as const };
    if (anyone) await service.createBookingForFirstAvailable({ ...data, candidateStylistIds: ['stylist-1'] });
    else await service.createBooking({ ...data, stylistId: 'stylist-1' });
    assert.equal(Number(stored[0].priceAtBooking), 100);
    assert.equal(stored[0].durationAtBooking, 60);
    assert.equal(stored[0].status, 'PENDING');
    assert.equal(stored[0].discountCodeId, undefined);
    assert.equal(stored[0].notificationLocale, 'zh-HK');
    const frozen = JSON.parse(String(stored[0].quoteJson));
    assert.equal(frozen.amountPence, 10000);
    assert.equal(frozen.priceType, 'STANDARD');
    assert.equal(frozen.vatDisplay, 'EXCLUDED');
    assert.equal(frozen.discountsApplied, false);
    assert.equal(code.usedCount, 0);
  });

  test(`${anyone ? 'Anyone' : 'named stylist'} booking refuses a discount code before any write and never counts it`, async () => {
    const { service, code, stored } = bookingFixture({ type: 'PERCENTAGE', value: 20 });
    const data = { serviceId: 'service-1', date: new Date('2099-09-14T10:00:00Z'), userId: 'user-1', discountCode: ' save ', expectedQuote: quote };
    await assert.rejects(anyone
      ? service.createBookingForFirstAvailable({ ...data, candidateStylistIds: ['stylist-1'] })
      : service.createBooking({ ...data, stylistId: 'stylist-1' }), /paused/i);
    assert.equal(code.usedCount, 0);
    assert.equal(stored.length, 0);
  });

  test(`${anyone ? 'Anyone' : 'named stylist'} booking returns the current price instead of booking at a stale one`, async () => {
    const { service, stored } = bookingFixture({ type: 'FIXED', value: 0 }, null, { priceVersion: 2 });
    const data = { serviceId: 'service-1', date: new Date('2099-09-14T10:00:00Z'), userId: 'user-1', expectedQuote: quote };
    await assert.rejects(anyone
      ? service.createBookingForFirstAvailable({ ...data, candidateStylistIds: ['stylist-1'] })
      : service.createBooking({ ...data, stylistId: 'stylist-1' }), (error: Error & { quote?: { priceVersion: number } }) => {
      assert.equal(error.name, 'PriceChangedError');
      assert.equal(error.quote?.priceVersion, 2);
      return true;
    });
    assert.equal(stored.length, 0);
  });

  test(`${anyone ? 'Anyone' : 'named stylist'} booking refuses an option closed to new bookings, even by direct id`, async () => {
    const { service, stored } = bookingFixture({ type: 'FIXED', value: 0 }, null, { bookable: false });
    const data = { serviceId: 'service-1', date: new Date('2099-09-14T10:00:00Z'), userId: 'user-1', expectedQuote: quote };
    await assert.rejects(anyone
      ? service.createBookingForFirstAvailable({ ...data, candidateStylistIds: ['stylist-1'] })
      : service.createBooking({ ...data, stylistId: 'stylist-1' }), /cannot be booked online/i);
    assert.equal(stored.length, 0);
  });
}

for (const anyone of [false, true]) {
  const label = anyone ? 'Anyone' : 'named stylist';
  const input = { stylistId: anyone ? ANY_STYLIST_ID : 'stylist-1', serviceId: 'service-1', date: '2099-09-14', time: '11:00', expectedQuote: quote };

  test(`${label} submit publishes its busy period before waiting for email delivery`, async () => {
    await assertFeedInvalidatesBeforeDelivery((hooks) => {
      const f = bookingFixture({ type: 'PERCENTAGE', value: 20 }, null, hooks);
      return f.actions.submitBooking(input);
    });
  });

  test(`${label} submit atomically records both request notices and dispatches only after commit`, async () => {
    const f = bookingFixture({ type: 'PERCENTAGE', value: 20 });
    const result = await f.actions.submitBooking(input);
    assert.equal(result.success, true);
    assert.equal(f.stored.length, 1);
    assert.equal(f.code.usedCount, 0);
    assert.equal(f.stored[0].status, 'PENDING');
    assert.deepEqual(f.events.map((event) => event.eventKey), [
      'appointment/appointment-1/0/REQUEST_RECEIVED',
      'appointment/appointment-1/0/SALON_ALERT',
    ]);
    for (const event of f.events) {
      const payload = JSON.parse(event.payloadJson);
      assert.equal(payload.appointment.price.amountPence, 10000);
      assert.equal(payload.appointment.service.duration, 60);
      assert.equal(payload.date, '2099-09-14T10:00:00.000Z');
    }
    assert.equal(JSON.parse(f.events[0].payloadJson).options.salonPhone, '020 0000 0000');
    assert.equal(f.delivered.length, 2);
    assert.equal(f.dispatches(), 1);
  });

  test(`${label} submit with a stale price returns the new quote and books nothing`, async () => {
    const f = bookingFixture({ type: 'FIXED', value: 0 }, null, { priceVersion: 2 });
    const result = await f.actions.submitBooking(input);
    assert.equal(result.success, false);
    assert.equal(!result.success && result.code, 'PRICE_CHANGED');
    assert.equal(!result.success && result.quote?.priceVersion, 2);
    assert.equal(f.stored.length, 0);
    assert.equal(f.events.length, 0);
  });

  test(`${label} submit from an old page that still sends a discount code is refused clearly and counts nothing`, async () => {
    const f = bookingFixture({ type: 'PERCENTAGE', value: 20 });
    const result = await f.actions.submitBooking({ ...input, discountCode: 'SAVE' });
    assert.equal(result.success, false);
    assert.equal(!result.success && result.code, 'DISCOUNTS_PAUSED');
    assert.equal(f.stored.length, 0);
    assert.equal(f.code.usedCount, 0);
  });

  test(`${label} submit refuses a retired option sent by id`, async () => {
    const f = bookingFixture({ type: 'FIXED', value: 0 }, null, { bookable: false });
    const result = await f.actions.submitBooking(input);
    assert.equal(!result.success && result.code, 'SERVICE_NOT_BOOKABLE');
    assert.equal(f.stored.length, 0);
  });

  test(`${label} rolls back the appointment and first notice when the second enqueue fails`, async () => {
    const f = bookingFixture({ type: 'PERCENTAGE', value: 20 }, null, { failEnqueueAt: 2 });
    const result = await f.actions.submitBooking(input);
    assert.equal(result.success, false);
    assert.equal(f.stored.length, 0);
    assert.equal(f.code.usedCount, 0);
    assert.equal(f.events.length, 0);
    assert.equal(f.delivered.length, 0);
    assert.equal(f.dispatches(), 0);
  });

  test(`${label} direct service call cannot bypass the final readiness check`, async () => {
    const f = bookingFixture({ type: 'PERCENTAGE', value: 20 }, null, { ready: false });
    const data = { serviceId: 'service-1', date: new Date('2099-09-14T10:00:00Z'), userId: 'user-1', expectedQuote: quote };
    const booking = anyone
      ? f.service.createBookingForFirstAvailable({ ...data, candidateStylistIds: ['stylist-1'] })
      : f.service.createBooking({ ...data, stylistId: 'stylist-1' });
    await assert.rejects(booking, /Online booking is closed/);
    assert.equal(f.stored.length, 0);
    assert.equal(f.code.usedCount, 0);
    assert.equal(f.events.length, 0);
    assert.equal(f.delivered.length, 0);
  });

  test(`${label} direct service call rechecks current hours and writes nothing`, async () => {
    const f = bookingFixture({ type: 'PERCENTAGE', value: 20 }, null, { hoursEnd: '11:45' });
    const data = { serviceId: 'service-1', date: new Date('2099-09-14T10:00:00Z'), userId: 'user-1', expectedQuote: quote };
    const booking = anyone
      ? f.service.createBookingForFirstAvailable({ ...data, candidateStylistIds: ['stylist-1'] })
      : f.service.createBooking({ ...data, stylistId: 'stylist-1' });
    await assert.rejects(booking, /outside business hours/);
    assert.equal(f.stored.length, 0);
    assert.equal(f.code.usedCount, 0);
    assert.equal(f.events.length, 0);
  });
}
