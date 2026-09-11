import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { BookingError } from './booking-errors';
import { ANY_STYLIST_ID } from '../lib/booking-constants';

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') }));
after(() => mock.timers.reset());

function bookingFixture(
  discount: { type: string; value: number; maxUses?: number; usedCount?: number },
  globalOffer: { discountType: string; discountValue: number } | null = null,
  options: { failEnqueueAt?: number; ready?: boolean; hoursEnd?: string } = {},
) {
  const stored: Record<string, unknown>[] = [];
  type Event = { id: string; eventKey: string; appointmentId: string; kind: string; payloadJson: string; delivered?: boolean };
  const events: Event[] = [];
  const delivered: Event[] = [];
  let stagedEvents: Event[] = [];
  let transactionActive = false;
  let enqueueCalls = 0;
  let dispatches = 0;
  const code = { id: 'code-1', code: 'SAVE', isActive: true, expiresAt: null, maxUses: null, usedCount: 0, ...discount };
  const liveService = { id: 'service-1', name: 'Cut', price: 100, duration: 60, treatwellExternalId: null, requiresPatchTest: false, requiresConsultation: false, isConsultation: false, isPatchTest: false };
  const hours = { startTime: '09:00', endTime: options.hoursEnd ?? '18:00' };
  const tx = {
    service: { findUnique: async () => liveService },
    stylist: {
      findUnique: async () => ({ id: 'stylist-1', name: 'Stylist', treatwellExternalId: null }),
      findMany: async () => [{ id: 'stylist-1', name: 'Stylist', availabilities: [hours] }],
    },
    availability: { findFirst: async () => hours },
    appointment: {
      count: async () => stored.length,
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `appointment-${stored.length + 1}`, notificationVersion: 0, ...data, user: { name: 'Customer', email: 'customer@example.test', phone: null }, stylist: { name: 'Stylist' }, service: { ...liveService } };
        stored.push(row);
        return row;
      },
    },
    externalBusyBlock: { findMany: async () => [] },
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
      if (options.ready === false) throw new BookingError('Online booking is closed');
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
    'next/cache': { revalidatePath: () => undefined },
  });
  return { service, code, stored, events, delivered, actions, dispatches: () => dispatches };
}

for (const anyone of [false, true]) {
  test(`${anyone ? 'Anyone' : 'named stylist'} booking persists the 20% code price and consumes one use`, async () => {
    const { service, code, stored } = bookingFixture({ type: 'PERCENTAGE', value: 20 });
    const data = { serviceId: 'service-1', date: new Date('2099-09-14T10:00:00Z'), userId: 'user-1', discountCode: ' save ' };
    if (anyone) await service.createBookingForFirstAvailable({ ...data, candidateStylistIds: ['stylist-1'] });
    else await service.createBooking({ ...data, stylistId: 'stylist-1' });
    assert.equal(stored[0].priceAtBooking, 80);
    assert.equal(stored[0].durationAtBooking, 60);
    assert.equal(stored[0].status, 'PENDING');
    assert.equal(stored[0].discountCodeId, 'code-1');
    assert.equal(code.usedCount, 1);
  });
}

test('discount codes apply after the global offer and never make the frozen price negative', async () => {
  for (const [value, expected] of [[5, 75], [90, 0]]) {
    const { service, stored } = bookingFixture({ type: 'FIXED', value }, { discountType: 'PERCENTAGE', discountValue: 20 });
    await service.createBooking({ stylistId: 'stylist-1', serviceId: 'service-1', date: new Date('2099-09-14T10:00:00Z'), userId: 'user-1', discountCode: 'SAVE' });
    assert.equal(stored[0].priceAtBooking, expected);
  }
});

test('an exhausted discount rejects the whole booking without consuming another use', async () => {
  const { service, code, stored } = bookingFixture({ type: 'FIXED', value: 5, maxUses: 1, usedCount: 1 });
  await assert.rejects(service.createBooking({ stylistId: 'stylist-1', serviceId: 'service-1', date: new Date('2099-09-14T10:00:00Z'), userId: 'user-1', discountCode: 'SAVE' }), /Discount code/);
  assert.equal(code.usedCount, 1);
  assert.equal(stored.length, 0);
});

for (const anyone of [false, true]) {
  const label = anyone ? 'Anyone' : 'named stylist';
  const input = { stylistId: anyone ? ANY_STYLIST_ID : 'stylist-1', serviceId: 'service-1', date: '2099-09-14', time: '11:00', discountCode: 'SAVE' };

  test(`${label} submit atomically records both request notices and dispatches only after commit`, async () => {
    const f = bookingFixture({ type: 'PERCENTAGE', value: 20 });
    const result = await f.actions.submitBooking(input);
    assert.equal(result.success, true);
    assert.equal(f.stored.length, 1);
    assert.equal(f.code.usedCount, 1);
    assert.equal(f.stored[0].status, 'PENDING');
    assert.deepEqual(f.events.map((event) => event.eventKey), [
      'appointment/appointment-1/0/REQUEST_RECEIVED',
      'appointment/appointment-1/0/SALON_ALERT',
    ]);
    for (const event of f.events) {
      const payload = JSON.parse(event.payloadJson);
      assert.equal(payload.appointment.service.price, 80);
      assert.equal(payload.appointment.service.duration, 60);
      assert.equal(payload.date, '2099-09-14T10:00:00.000Z');
    }
    assert.equal(JSON.parse(f.events[0].payloadJson).options.salonPhone, '020 0000 0000');
    assert.equal(f.delivered.length, 2);
    assert.equal(f.dispatches(), 1);
  });

  test(`${label} rolls back the appointment, discount use, and first notice when the second enqueue fails`, async () => {
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
    const data = { serviceId: 'service-1', date: new Date('2099-09-14T10:00:00Z'), userId: 'user-1', discountCode: 'SAVE' };
    const booking = anyone
      ? f.service.createBookingForFirstAvailable({ ...data, candidateStylistIds: ['stylist-1'] })
      : f.service.createBooking({ ...data, stylistId: 'stylist-1' });
    await assert.rejects(booking, /Online booking is closed/);
    assert.equal(f.stored.length, 0);
    assert.equal(f.code.usedCount, 0);
    assert.equal(f.events.length, 0);
    assert.equal(f.delivered.length, 0);
  });

  test(`${label} direct service call rechecks current hours and rolls back a claimed discount`, async () => {
    const f = bookingFixture({ type: 'PERCENTAGE', value: 20 }, null, { hoursEnd: '11:45' });
    const data = { serviceId: 'service-1', date: new Date('2099-09-14T10:00:00Z'), userId: 'user-1', discountCode: 'SAVE' };
    const booking = anyone
      ? f.service.createBookingForFirstAvailable({ ...data, candidateStylistIds: ['stylist-1'] })
      : f.service.createBooking({ ...data, stylistId: 'stylist-1' });
    await assert.rejects(booking, /outside business hours/);
    assert.equal(f.stored.length, 0);
    assert.equal(f.code.usedCount, 0);
    assert.equal(f.events.length, 0);
  });
}
