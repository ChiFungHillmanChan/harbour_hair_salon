import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { assertFeedInvalidatesBeforeDelivery, type NotificationTimingHooks } from '../../test/stalled-notification';
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
  /** A synced Fresha booking with exactly this appointment's start and end. */
  externalSameTime?: boolean;
  currentDate?: Date;
  changeAfterRead?: 'cancel' | 'reschedule' | 'confirm';
  failEnqueue?: boolean;
  onlineReady?: boolean;
  calendarReady?: boolean;
  onFeedRefresh?: () => void;
  trace?: string[];
  /** Which reschedule allowance is spent: the customer's, or this appointment's. */
  rescheduleSpent?: 'user' | 'appointment';
} & NotificationTimingHooks = {}) {
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
  type Notification = { service: { duration: number }; price: { amountPence: number } };
  const messages: { kind: string; appointment: Notification }[] = [];
  type Event = { id: string; eventKey: string; appointmentId: string; kind: string; payloadJson: string; delivered?: boolean };
  const events: Event[] = [];
  let stagedEvents: Event[] = [];
  let transactionActive = false;
  let dispatches = 0;
  let transactions = 0;
  let writes = 0;
  const limiterKeys: string[] = [];
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
    auditEvent: { create: async () => { assert.equal(transactionActive, true); return { id: "audit" }; } },
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
        writes++;
        if (!matches(appointment, where)) return { count: 0 };
        applyData(data); return { count: 1 };
      },
    },
    availability: { findFirst: async () => ({ startTime: '09:00', endTime: options.hoursEnd ?? '18:00', isOff: false }) },
    externalBusyBlock: { findMany: async () => [
      ...(options.externalConflict ? [{ stylistId: 'stylist-1', start: new Date('2099-09-14T12:15:00Z'), end: new Date('2099-09-14T13:00:00Z') }] : []),
      ...(options.externalSameTime ? [{ stylistId: 'stylist-1', start: new Date(originalDate), end: new Date(originalDate.getTime() + 60 * 60_000) }] : []),
    ] },
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
      transactions++;
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
      await options.onDispatch?.();
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
      if (options.onlineReady === false) throw new BookingError('MAINTENANCE');
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
    '@/app/lib/rate-limit': {
      rescheduleLimiter: { check: async (key: string) => { limiterKeys.push(key); return options.rescheduleSpent !== 'user'; } },
      appointmentRescheduleLimiter: { check: async (key: string) => { limiterKeys.push(key); return options.rescheduleSpent !== 'appointment'; } },
    },
    '@/app/services/site-settings-service': {},
    '@/app/actions/admin-services': {},
    '@/app/services/notification-outbox-service': queue,
    '@/app/services/integration-readiness': {
      checkCalendarBookingReadiness: async (database: unknown) => {
        assert.equal(database, tx, 'approval readiness must use the transaction client');
        options.trace?.push('readiness');
        return { ready: options.calendarReady !== false, blockers: [] };
      },
    },
    '@/app/services/calendar-sync-service': {
      refreshStaleCalendarFeeds: async () => {
        assert.equal(transactionActive, false, 'marketplace feeds must not be fetched inside the transaction');
        options.trace?.push('refresh');
        options.onFeedRefresh?.();
        return [];
      },
    },
    '@/app/services/stylist-ical-cache': {
      invalidateStylistIcalFeed: () => {
        assert.equal(transactionActive, false, 'feed invalidation must follow commit');
        options.onFeedInvalidated?.();
      },
      invalidateStylistIcalToken: () => undefined,
    },
    'next/cache': { revalidatePath: () => undefined, updateTag: () => undefined },
    'next/server': { after: (callback: () => unknown) => options.scheduleAfterResponse ? options.scheduleAfterResponse(callback) : callback() },
  };
  const actions = loadServerModule<typeof import('./booking')>('src/app/actions/booking.ts', dependencies);
  const admin = loadServerModule<typeof import('./admin')>('src/app/actions/admin.ts', dependencies);
  return {
    appointment, originalDate, messages, events, dispatches: () => dispatches, actions, admin,
    transactions: () => transactions, writes: () => writes, limiterKeys,
  };
}

for (const operation of ['cancel', 'reschedule', 'approve', 'decline'] as const) {
  test(`${operation} updates the busy feed before waiting for email delivery`, async () => {
    await assertFeedInvalidatesBeforeDelivery((hooks) => {
      const f = fixture({ ...hooks, status: operation === 'approve' || operation === 'decline' ? 'PENDING' : 'CONFIRMED' });
      if (operation === 'cancel') return f.actions.cancelAppointment(f.appointment.id);
      if (operation === 'reschedule') return f.actions.rescheduleAppointment(f.appointment.id, '2099-09-15', '10:00');
      return f.admin.updateAppointmentStatus(f.appointment.id, operation === 'approve' ? 'CONFIRMED' : 'CANCELLED');
    });
  });
}

test('rescheduling a frozen 60-minute booking cannot overlap a booking 45 minutes later', async () => {
  const { actions, appointment, originalDate, messages } = fixture({ conflictingBooking: true });
  const result = await actions.rescheduleAppointment(appointment.id, '2099-09-15', '10:00');
  assert.equal(result.success, false);
  assert.equal(appointment.date.getTime(), originalDate.getTime());
  assert.equal(messages.length, 0);
});

test('rescheduling to the time a booking already has sends nothing, however often', async () => {
  // 12:00Z on 14 September is 13:00 in London (BST): the booking's own time.
  let feedInvalidations = 0;
  const f = fixture({ onFeedInvalidated: () => { feedInvalidations++; } });
  for (let attempt = 0; attempt < 8; attempt++) {
    assert.deepEqual(await f.actions.rescheduleAppointment(f.appointment.id, '2099-09-14', '13:00'), { success: true });
  }
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
  assert.equal(f.appointment.notificationVersion, 0);
  assert.equal(f.appointment.reminderSent, true, 'the reminder is not re-armed either');
  assert.equal(f.writes(), 0);
  assert.equal(f.transactions(), 0);
  assert.equal(f.events.length, 0);
  assert.equal(f.dispatches(), 0);
  assert.equal(f.messages.length, 0);
  assert.equal(feedInvalidations, 0);
  assert.deepEqual(f.limiterKeys, [], 'a no-op spends no reschedule allowance');
});

for (const spent of ['user', 'appointment'] as const) {
  test(`a spent ${spent} reschedule allowance refuses the move before any transaction`, async () => {
    const f = fixture({ rescheduleSpent: spent });
    const result = await f.actions.rescheduleAppointment(f.appointment.id, '2099-09-15', '10:00');
    assert.equal(result.success, false);
    assert.equal('code' in result && result.code, 'TOO_MANY_RESCHEDULES');
    assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
    assert.equal(f.transactions(), 0);
    assert.equal(f.writes(), 0);
    assert.equal(f.messages.length, 0);
    assert.deepEqual(f.limiterKeys, spent === 'user' ? ['user:user-1'] : ['user:user-1', 'appt:appointment-1']);
  });
}

test('a time the salon refuses spends no reschedule allowance', async () => {
  // Closes at 10:30, so a 60-minute booking at 10:00 would over-run.
  const f = fixture({ hoursEnd: '10:30' });
  const result = await f.actions.rescheduleAppointment(f.appointment.id, '2099-09-15', '10:00');
  assert.equal('code' in result && result.code, 'OUTSIDE_HOURS');
  assert.deepEqual(f.limiterKeys, [], 'only a move that can actually happen is counted');
});

test("another customer's booking cannot spend its reschedule allowance", async () => {
  const f = fixture();
  f.appointment.userId = 'someone-else';
  const result = await f.actions.rescheduleAppointment(f.appointment.id, '2099-09-15', '10:00');
  assert.equal('code' in result && result.code, 'APPOINTMENT_NOT_FOUND');
  assert.deepEqual(f.limiterKeys, []);
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
  assert.equal(messages[0].appointment.price.amountPence, 8000);
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

// Fresha never re-exports the busy feed it imports from us (verified live
// 2026-09-29), so a synced block at exactly the request's time is a real Fresha
// booking made before our feed reached Fresha — approving would double-book.
test('admin approval is refused by a Fresha booking at exactly the same time', async () => {
  const { admin, appointment, messages } = fixture({ status: 'PENDING', externalSameTime: true });
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
  assert.equal(messages[0].appointment.price.amountPence, 8000);
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
  // 13:30 BST (12:30Z) runs into the synced 12:15Z–13:00Z block. (13:00 is the
  // booking's own time, which is now a no-op rather than a move.)
  const { actions, appointment, messages } = fixture({ externalConflict: true });
  assert.equal((await actions.rescheduleAppointment(appointment.id, '2099-09-14', '13:30')).success, false);
  assert.equal(messages.length, 0);
});

test('admin approval refreshes stale marketplace feeds first; other status changes do not', async () => {
  const calls: string[] = [];
  const approve = fixture({ status: 'PENDING', onFeedRefresh: () => calls.push('approve') });
  assert.equal((await approve.admin.updateAppointmentStatus(approve.appointment.id, 'CONFIRMED')).success, true);
  const cancel = fixture({ status: 'PENDING', onFeedRefresh: () => calls.push('cancel') });
  assert.equal((await cancel.admin.updateAppointmentStatus(cancel.appointment.id, 'CANCELLED')).success, true);
  assert.deepEqual(calls, ['approve']);
});

test('the feed refresh runs BEFORE the approval readiness check, or evening approvals fail again', async () => {
  const trace: string[] = [];
  const f = fixture({ status: 'PENDING', trace });
  assert.equal((await f.admin.updateAppointmentStatus(f.appointment.id, 'CONFIRMED')).success, true);
  assert.deepEqual(trace, ['refresh', 'readiness']);
});

// Date is mocked (2099-09-01T12:00Z), so the boundary is exact, not flaky.
for (const [label, offsetMinutes, allowed] of [
  ['exactly 24 hours', 24 * 60, true],
  ['24 hours minus one minute', 24 * 60 - 1, false],
] as const) {
  test(`a confirmed booking ${label} away ${allowed ? 'can' : 'cannot'} be cancelled or rescheduled`, async () => {
    const currentDate = new Date(Date.now() + offsetMinutes * 60_000);
    const cancel = fixture({ currentDate });
    const cancelled = await cancel.actions.cancelAppointment(cancel.appointment.id);
    assert.equal(cancelled.success, allowed, JSON.stringify(cancelled));
    if (!allowed) assert.match(String(cancelled.error), /24 hours/);
    const move = fixture({ currentDate });
    const moved = await move.actions.rescheduleAppointment(move.appointment.id, '2099-09-15', '10:00');
    assert.equal(moved.success, allowed, JSON.stringify(moved));
    if (!allowed) assert.match(String(moved.error), /24 hours/);
  });
}

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
  assert.equal(payload.appointment.price.amountPence, 8000);
  assert.equal(payload.appointment.service.duration, 60);
  assert.equal(f.dispatches(), 1);
});
