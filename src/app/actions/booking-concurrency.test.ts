import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { BookingError } from '../services/booking-errors';

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') }));
after(() => mock.timers.reset());

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
    if (expected && typeof expected === 'object') {
      const filter = expected as Record<string, unknown>;
      if ('not' in filter) return actual !== filter.not;
      if ('in' in filter) return (filter.in as unknown[]).includes(actual);
      if ('gte' in filter && (actual as Date) < (filter.gte as Date)) return false;
      if ('lte' in filter && (actual as Date) > (filter.lte as Date)) return false;
      return true;
    }
    return actual === expected;
  });
}

function fixture(options: {
  status?: string;
  durationAtBooking?: number | null;
  hoursEnd?: string;
  conflictingBooking?: boolean;
  externalConflict?: boolean;
  currentDate?: Date;
  changeAfterRead?: 'cancel' | 'reschedule' | 'confirm';
  failEnqueue?: boolean;
  onlineReady?: boolean;
  calendarReady?: boolean;
} = {}) {
  const originalDate = options.currentDate ?? new Date('2099-09-14T12:00:00Z');
  const appointment = {
    id: 'appointment-1', userId: 'user-1', stylistId: 'stylist-1', serviceId: 'service-1',
    date: originalDate, status: options.status ?? 'CONFIRMED', durationAtBooking: options.durationAtBooking === undefined ? 60 : options.durationAtBooking,
    priceAtBooking: 80, reminderSent: true, notificationVersion: 0,
    updatedAt: new Date('2099-09-01T00:00:00Z'), treatwellBookingId: null,
    user: { name: 'Customer', email: 'customer@example.test' },
    stylist: { name: 'Stylist', treatwellExternalId: null },
    service: { name: 'Cut', duration: 30, price: 100, requiresPatchTest: false, treatwellExternalId: null },
  };
  type Notification = { service: { duration: number; price: number } };
  const messages: { kind: string; appointment: Notification }[] = [];
  type Event = { id: string; eventKey: string; appointmentId: string; kind: string; payloadJson: string; delivered?: boolean };
  const events: Event[] = [];
  let stagedEvents: Event[] = [];
  let transactionActive = false;
  let dispatches = 0;
  let externallyCommitted: Partial<typeof appointment> = {};
  let reads = 0;
  const applyData = (data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      const record = appointment as unknown as Record<string, unknown>;
      record[key] = value && typeof value === 'object' && 'increment' in value
        ? Number(record[key]) + Number(value.increment) : value;
    }
  };
  const tx = {
    appointment: {
      findUnique: async () => {
        const result = structuredClone(appointment);
        if (reads++ === 0 && options.changeAfterRead) {
          if (options.changeAfterRead === 'cancel') appointment.status = 'CANCELLED';
          if (options.changeAfterRead === 'confirm') appointment.status = 'CONFIRMED';
          if (options.changeAfterRead === 'reschedule') appointment.date = new Date('2099-09-16T09:00:00Z');
          appointment.updatedAt = new Date('2099-09-02T00:00:00Z');
          externallyCommitted = { status: appointment.status, date: appointment.date, updatedAt: appointment.updatedAt };
        }
        return result;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => [appointment, ...(options.conflictingBooking ? [{
        id: 'other', stylistId: 'stylist-1', status: 'CONFIRMED', date: new Date('2099-09-15T09:45:00Z'), durationAtBooking: 60,
        service: { duration: 30 },
      }] : [])].filter((row) => matches(row, where)),
      update: async ({ data }: { data: Record<string, unknown> }) => { applyData(data); return structuredClone(appointment); },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matches(appointment, where)) return { count: 0 };
        applyData(data); return { count: 1 };
      },
    },
    availability: { findFirst: async () => ({ startTime: '09:00', endTime: options.hoursEnd ?? '18:00', isOff: false }) },
    externalBusyBlock: { findMany: async () => options.externalConflict ? [{
      stylistId: 'stylist-1', start: new Date('2099-09-14T12:15:00Z'), end: new Date('2099-09-14T13:00:00Z'),
    }] : [] },
    notificationDelivery: {
      findUnique: async ({ where }: { where: { eventKey: string } }) => [...events, ...stagedEvents].find((event) => event.eventKey === where.eventKey) ?? null,
      upsert: async ({ create }: { create: Omit<Event, 'id'> }) => {
        assert.equal(transactionActive, true, 'notification persistence must be inside the appointment transaction');
        if (options.failEnqueue) throw new Error('queue write failed');
        const event = { ...create, id: `event-${events.length + stagedEvents.length + 1}` };
        stagedEvents.push(event);
        return { id: event.id };
      },
    },
  };
  const db = {
    ...tx,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const before = structuredClone(appointment);
      transactionActive = true;
      try {
        const result = await fn(tx);
        events.push(...stagedEvents);
        return result;
      } catch (error) {
        Object.assign(appointment, before, externallyCommitted);
        throw error;
      } finally {
        stagedEvents = [];
        transactionActive = false;
      }
    },
  };
  // Keep the real snapshot/event-key builder; replace only durable storage and
  // delivery I/O. A separate transaction client catches accidental global writes.
  const outbox = loadServerModule<typeof import('../services/notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
    '@/app/lib/prisma': db, './email-service': {},
  });
  const queue = {
    enqueueAppointmentNotification: async (database: unknown, ...args: Parameters<typeof outbox.enqueueAppointmentNotification> extends [unknown, ...infer Rest] ? Rest : never) => {
      assert.equal(database, tx, 'enqueue must use the appointment transaction client');
      assert.equal(transactionActive, true);
      return outbox.enqueueAppointmentNotification(tx as never, ...args);
    },
    dispatchAppointmentNotifications: async (appointmentId: string) => {
      assert.equal(transactionActive, false, 'delivery must start after commit');
      dispatches++;
      for (const event of events.filter((event) => event.appointmentId === appointmentId && !event.delivered)) {
        const payload = JSON.parse(event.payloadJson);
        messages.push({ kind: event.kind.toLowerCase(), appointment: payload.appointment });
        event.delivered = true;
      }
    },
  };
  const bookingReadiness = {
    isBookingEnabled: async () => true,
    assertOnlineBookingReady: async (database: unknown) => {
      assert.equal(database, tx, 'the final readiness check must use the transaction client');
      if (options.onlineReady === false) throw new BookingError('Online booking is closed');
      return { phone: '020 0000 0000', bookingEnabled: true };
    },
  };
  const service = loadServerModule<typeof import('../services/booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': db, './offers-service': { getActiveGlobalOffer: async () => null },
    '@/app/lib/booking-maintenance': bookingReadiness,
    './notification-outbox-service': queue,
  });
  const dependencies = {
    '@/app/lib/prisma': db,
    '@/app/services/booking-service': service,
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1', role: 'ADMIN' }) },
    '@/app/lib/booking-maintenance': bookingReadiness,
    '@/app/lib/rate-limit': {},
    '@/app/services/site-settings-service': {},
    '@/app/actions/admin-services': {},
    '@/app/services/notification-outbox-service': queue,
    '@/app/services/integration-readiness': {
      checkCalendarBookingReadiness: async (database: unknown) => {
        assert.equal(database, tx, 'approval readiness must use the transaction client');
        return { ready: options.calendarReady !== false, blockers: [] };
      },
    },
    'next/cache': { revalidatePath: () => undefined, updateTag: () => undefined },
  };
  const actions = loadServerModule<typeof import('./booking')>('src/app/actions/booking.ts', dependencies);
  const admin = loadServerModule<typeof import('./admin')>('src/app/actions/admin.ts', dependencies);
  return { appointment, originalDate, messages, events, dispatches: () => dispatches, actions, admin };
}

test('rescheduling a frozen 60-minute booking cannot overlap a booking 45 minutes later', async () => {
  const { actions, appointment, originalDate, messages } = fixture({ conflictingBooking: true });
  const result = await actions.rescheduleAppointment(appointment.id, '2099-09-15', '10:00');
  assert.equal(result.success, false);
  assert.equal(appointment.date.getTime(), originalDate.getTime());
  assert.equal(messages.length, 0);
});

test('rescheduling must fit the entire frozen duration before closing', async () => {
  const { actions, appointment } = fixture({ hoursEnd: '10:45' });
  assert.equal((await actions.rescheduleAppointment(appointment.id, '2099-09-15', '10:00')).success, false);
});

for (const changeAfterRead of ['cancel', 'reschedule'] as const) {
  test(`rescheduling rejects a concurrent ${changeAfterRead} without overwriting it or emailing`, async () => {
    const { actions, appointment, messages } = fixture({ changeAfterRead });
    assert.equal((await actions.rescheduleAppointment(appointment.id, '2099-09-15', '10:00')).success, false);
    assert.equal(messages.length, 0);
    if (changeAfterRead === 'cancel') assert.equal(appointment.status, 'CANCELLED');
    else assert.equal(appointment.date.toISOString(), '2099-09-16T09:00:00.000Z');
  });
}

test('a successful reschedule retains frozen price/duration and increments the event version once', async () => {
  const { actions, appointment, messages } = fixture();
  assert.equal((await actions.rescheduleAppointment(appointment.id, '2099-09-15', '10:00')).success, true);
  assert.equal(appointment.date.toISOString(), '2099-09-15T09:00:00.000Z');
  assert.equal(appointment.reminderSent, false);
  assert.equal(appointment.notificationVersion, 1);
  assert.equal(messages[0].appointment.service.duration, 60);
  assert.equal(messages[0].appointment.service.price, 80);
});

test('legacy bookings without a frozen duration still use the service duration', async () => {
  const { actions, appointment } = fixture({ durationAtBooking: null, conflictingBooking: true });
  assert.equal((await actions.rescheduleAppointment(appointment.id, '2099-09-15', '10:00')).success, true);
});

test('admin approval cannot revive a request cancelled after its initial read', async () => {
  const { admin, appointment, messages } = fixture({ status: 'PENDING', changeAfterRead: 'cancel' });
  assert.equal((await admin.updateAppointmentStatus(appointment.id, 'CONFIRMED')).success, false);
  assert.equal(appointment.status, 'CANCELLED');
  assert.equal(messages.length, 0);
});

test('admin approval checks new external busy blocks before confirming', async () => {
  const { admin, appointment, messages } = fixture({ status: 'PENDING', externalConflict: true });
  assert.equal((await admin.updateAppointmentStatus(appointment.id, 'CONFIRMED')).success, false);
  assert.equal(appointment.status, 'PENDING');
  assert.equal(messages.length, 0);
});

test('admin approval respects current opening hours and the frozen duration', async () => {
  const { admin, appointment } = fixture({ status: 'PENDING', hoursEnd: '13:45' });
  assert.equal((await admin.updateAppointmentStatus(appointment.id, 'CONFIRMED')).success, false);
});

for (const status of ['PENDING', 'CONFIRMED']) {
  test(`admin cancellation of ${status} sends a cancellation notice once`, async () => {
    const { admin, appointment, messages } = fixture({ status });
    assert.equal((await admin.updateAppointmentStatus(appointment.id, 'CANCELLED')).success, true);
    assert.equal(appointment.status, 'CANCELLED');
    assert.equal(appointment.notificationVersion, 1);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].kind, 'cancellation');
    assert.equal(messages[0].appointment.service.duration, 60);
    await admin.updateAppointmentStatus(appointment.id, 'CANCELLED');
    assert.equal(messages.length, 1);
  });
}

test('customer cancellation cannot use stale pending status to bypass a concurrent confirmation', async () => {
  const { actions, appointment, messages } = fixture({ status: 'PENDING', changeAfterRead: 'confirm' });
  assert.equal((await actions.cancelAppointment(appointment.id)).success, false);
  assert.equal(appointment.status, 'CONFIRMED');
  assert.equal(messages.length, 0);
});

test('approval sends frozen booking details once and leaves the manual confirmation flow intact', async () => {
  const { admin, appointment, messages } = fixture({ status: 'PENDING' });
  assert.equal((await admin.updateAppointmentStatus(appointment.id, 'CONFIRMED')).success, true);
  assert.equal(appointment.status, 'CONFIRMED');
  assert.equal(appointment.notificationVersion, 1);
  assert.equal(messages[0].kind, 'confirmation');
  assert.equal(messages[0].appointment.service.price, 80);
  assert.equal(messages[0].appointment.service.duration, 60);
  await admin.updateAppointmentStatus(appointment.id, 'CONFIRMED');
  assert.equal(messages.length, 1);
  assert.equal(appointment.notificationVersion, 1);
});

test('admin approval rejects an internal booking that now overlaps the pending request', async () => {
  const { admin, appointment } = fixture({ status: 'PENDING', conflictingBooking: true, currentDate: new Date('2099-09-15T09:00:00Z') });
  assert.equal((await admin.updateAppointmentStatus(appointment.id, 'CONFIRMED')).success, false);
  assert.equal(appointment.status, 'PENDING');
});

test('rescheduling cannot overlap an imported external booking', async () => {
  const { actions, appointment, messages } = fixture({ externalConflict: true });
  assert.equal((await actions.rescheduleAppointment(appointment.id, '2099-09-14', '13:00')).success, false);
  assert.equal(messages.length, 0);
});

test('confirmed appointments retain the 24-hour change restriction while pending requests can be withdrawn', async () => {
  const currentDate = new Date(Date.now() + 60 * 60_000);
  const confirmed = fixture({ currentDate });
  assert.equal((await confirmed.actions.cancelAppointment(confirmed.appointment.id)).success, false);
  assert.equal((await confirmed.actions.rescheduleAppointment(confirmed.appointment.id, '2099-09-15', '10:00')).success, false);
  assert.equal(confirmed.appointment.status, 'CONFIRMED');
  const pending = fixture({ status: 'PENDING', currentDate });
  assert.equal((await pending.actions.cancelAppointment(pending.appointment.id)).success, true);
  assert.equal(pending.appointment.status, 'CANCELLED');
  assert.equal(pending.messages.length, 1);
});

for (const operation of ['approve', 'admin-cancel', 'customer-cancel', 'reschedule'] as const) {
  test(`a failed notification enqueue rolls back ${operation} without dispatching`, async () => {
    const initialStatus = operation === 'approve' ? 'PENDING' : 'CONFIRMED';
    const f = fixture({ status: initialStatus, failEnqueue: true });
    const result = operation === 'reschedule'
      ? await f.actions.rescheduleAppointment(f.appointment.id, '2099-09-15', '10:00')
      : operation === 'customer-cancel'
        ? await f.actions.cancelAppointment(f.appointment.id)
        : await f.admin.updateAppointmentStatus(f.appointment.id, operation === 'approve' ? 'CONFIRMED' : 'CANCELLED');
    assert.equal(result.success, false);
    assert.equal(f.appointment.status, initialStatus);
    assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
    assert.equal(f.appointment.notificationVersion, 0);
    assert.equal(f.appointment.reminderSent, true);
    assert.equal(f.events.length, 0);
    assert.equal(f.messages.length, 0);
    assert.equal(f.dispatches(), 0);
  });
}

test('rescheduling rechecks readiness in the transaction even when the earlier public check passed', async () => {
  const f = fixture({ onlineReady: false });
  const result = await f.actions.rescheduleAppointment(f.appointment.id, '2099-09-15', '10:00');
  assert.equal(result.success, false);
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
  assert.equal(f.appointment.notificationVersion, 0);
  assert.equal(f.events.length, 0);
  assert.equal(f.dispatches(), 0);
});

test('admin approval cannot bypass calendar readiness', async () => {
  const f = fixture({ status: 'PENDING', calendarReady: false });
  const result = await f.admin.updateAppointmentStatus(f.appointment.id, 'CONFIRMED');
  assert.equal(result.success, false);
  assert.equal(f.appointment.status, 'PENDING');
  assert.equal(f.events.length, 0);
  assert.equal(f.dispatches(), 0);
});

test('cancellation remains available while online booking and calendar readiness are blocked', async () => {
  const customer = fixture({ onlineReady: false, calendarReady: false });
  assert.equal((await customer.actions.cancelAppointment(customer.appointment.id)).success, true);
  assert.equal(customer.appointment.status, 'CANCELLED');
  assert.equal(customer.messages.length, 1);
  const admin = fixture({ status: 'PENDING', onlineReady: false, calendarReady: false });
  assert.equal((await admin.admin.updateAppointmentStatus(admin.appointment.id, 'CANCELLED')).success, true);
  assert.equal(admin.appointment.status, 'CANCELLED');
  assert.equal(admin.messages.length, 1);
});

test('a reschedule persists its old date and frozen details under the new event version before delivery', async () => {
  const f = fixture();
  assert.equal((await f.actions.rescheduleAppointment(f.appointment.id, '2099-09-15', '10:00')).success, true);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].eventKey, 'appointment/appointment-1/1/RESCHEDULE');
  const payload = JSON.parse(f.events[0].payloadJson);
  assert.equal(payload.version, 1);
  assert.equal(payload.options.oldDate, '2099-09-14T12:00:00.000Z');
  assert.equal(payload.appointment.date, '2099-09-15T09:00:00.000Z');
  assert.equal(payload.appointment.service.price, 80);
  assert.equal(payload.appointment.service.duration, 60);
  assert.equal(f.dispatches(), 1);
});
