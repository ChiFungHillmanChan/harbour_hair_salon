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
    if (expected === null) return actual === null || actual === undefined;
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
  changeAfterRead?: 'cancel' | 'reschedule' | 'confirm' | 'request';
  failEnqueue?: boolean;
  onlineReady?: boolean;
  calendarReady?: boolean;
  onFeedRefresh?: (stylistId: string) => void;
  trace?: string[];
  /** Which reschedule allowance is spent: the customer's, or this appointment's. */
  rescheduleSpent?: 'user' | 'appointment';
  /** Weekdays (0 = Sunday) on which the stylist does not work. */
  offDays?: number[];
  /** A COMPLETED patch test at this instant; colour services require one. */
  patchTestDate?: Date;
  requiresPatchTest?: boolean;
  /** An already-open reschedule request on the fixture appointment. */
  openRequest?: { requestedDate: Date; requestedAt: Date };
  /** The session's role (default ADMIN, as today). */
  role?: 'ADMIN' | 'USER';
  /** The salon phone in SiteSettings; absent = no settings row (no phone, no callout). */
  salonPhone?: string;
} & NotificationTimingHooks = {}) {
  const originalDate = options.currentDate ?? new Date('2099-09-14T12:00:00Z');
  const appointment = {
    id: 'appointment-1', userId: 'user-1', stylistId: 'stylist-1', serviceId: 'service-1',
    date: originalDate, status: options.status ?? 'CONFIRMED', durationAtBooking: options.durationAtBooking === undefined ? 60 : options.durationAtBooking,
    priceAtBooking: 80, reminderSent: true, notificationVersion: 0,
    updatedAt: new Date('2099-09-01T00:00:00Z'), treatwellBookingId: null,
    rescheduleRequestedDate: (options.openRequest?.requestedDate ?? null) as Date | null,
    rescheduleRequestedAt: (options.openRequest?.requestedAt ?? null) as Date | null,
    user: { name: 'Customer', email: 'customer@example.test' },
    stylist: { name: 'Stylist', treatwellExternalId: null },
    service: { name: 'Cut', duration: 30, price: 100, requiresPatchTest: options.requiresPatchTest ?? false, treatwellExternalId: null },
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
  const audits: { action: string; metadata: Record<string, unknown> }[] = [];
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
    auditEvent: { create: async ({ data }: { data: { action: string; metadataJson: string } }) => {
      assert.equal(transactionActive, true);
      audits.push({ action: data.action, metadata: JSON.parse(data.metadataJson) });
      return { id: "audit" };
    } },
    siteSettings: { findUnique: async () => {
      assert.equal(transactionActive, true, 'salon settings are read inside the transaction');
      return options.salonPhone ? { phone: options.salonPhone, salonNotificationLocale: null } : null;
    } },
    appointment: {
      findUnique: async (args?: { select?: Record<string, unknown> }) => {
        // The stylist-only lookup that feeds the pre-approval Fresha refresh is
        // not the action's "initial read": answering it must not fire changeAfterRead.
        const select = args?.select;
        if (select && Object.keys(select).length === 1 && select.stylistId === true) return { stylistId: appointment.stylistId };
        const result = structuredClone(appointment);
        if (reads++ === 0 && options.changeAfterRead) {
          if (options.changeAfterRead === 'cancel') appointment.status = 'CANCELLED';
          if (options.changeAfterRead === 'confirm') appointment.status = 'CONFIRMED';
          if (options.changeAfterRead === 'reschedule') appointment.date = new Date('2099-09-16T09:00:00Z');
          if (options.changeAfterRead === 'request') {
            // Another tab committed a request for 10:00 BST on 15 Sep after this read.
            appointment.rescheduleRequestedDate = new Date('2099-09-15T09:00:00Z');
            appointment.rescheduleRequestedAt = new Date('2099-09-01T11:30:00Z');
          }
          appointment.updatedAt = new Date('2099-09-02T00:00:00Z');
          externallyCommitted = { status: appointment.status, date: appointment.date, updatedAt: appointment.updatedAt, rescheduleRequestedDate: appointment.rescheduleRequestedDate, rescheduleRequestedAt: appointment.rescheduleRequestedAt };
        }
        return result;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        if ((where.service as { isPatchTest?: boolean } | undefined)?.isPatchTest) {
          return options.patchTestDate ? [{ date: options.patchTestDate, status: 'COMPLETED' }] : [];
        }
        return [appointment, ...(options.conflictingBooking ? [{
          id: 'other', stylistId: 'stylist-1', status: 'CONFIRMED', date: new Date('2099-09-15T09:45:00Z'), durationAtBooking: 60,
          service: { duration: 30 },
        }] : [])].filter((row) => matches(row, where));
      },
      update: async ({ data }: { data: Record<string, unknown> }) => { applyData(data); return structuredClone(appointment); },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        writes++;
        if (!matches(appointment, where)) return { count: 0 };
        applyData(data); return { count: 1 };
      },
    },
    availability: { findFirst: async ({ where }: { where: { dayOfWeek: number } }) =>
      options.offDays?.includes(where.dayOfWeek) ? null : ({ startTime: '09:00', endTime: options.hoursEnd ?? '18:00', isOff: false }) },
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
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1', role: options.role ?? 'ADMIN' }) },
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
      refreshCalendarFeedsBeforeApproval: async (...args: unknown[]) => {
        assert.equal(transactionActive, false, 'marketplace feeds must not be fetched inside the transaction');
        assert.equal(args.length, 1, 'approval paths pass only the stylist; the thresholds live in the helper');
        options.trace?.push('refresh');
        options.onFeedRefresh?.(args[0] as string);
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
    transactions: () => transactions, writes: () => writes, limiterKeys, audits,
  };
}

for (const operation of ['cancel', 'approve', 'decline'] as const) {
  test(`${operation} updates the busy feed before waiting for email delivery`, async () => {
    await assertFeedInvalidatesBeforeDelivery((hooks) => {
      const f = fixture({ ...hooks, status: operation === 'approve' || operation === 'decline' ? 'PENDING' : 'CONFIRMED' });
      if (operation === 'cancel') return f.actions.cancelAppointment(f.appointment.id);
      return f.admin.updateAppointmentStatus(f.appointment.id, operation === 'approve' ? 'CONFIRMED' : 'CANCELLED');
    });
  });
}

test('rescheduling a frozen 60-minute booking cannot overlap a booking 45 minutes later', async () => {
  const { actions, appointment, originalDate, messages } = fixture({ conflictingBooking: true });
  const result = await actions.requestReschedule(appointment.id, '2099-09-15', '10:00');
  assert.equal(result.success, false);
  assert.equal(appointment.rescheduleRequestedAt, null);
  assert.equal(appointment.date.getTime(), originalDate.getTime());
  assert.equal(messages.length, 0);
});

test('requesting the time a booking already has sends nothing, however often', async () => {
  // 12:00Z on 14 September is 13:00 in London (BST): the booking's own time.
  let feedInvalidations = 0;
  const f = fixture({ onFeedInvalidated: () => { feedInvalidations++; } });
  for (let attempt = 0; attempt < 8; attempt++) {
    assert.deepEqual(await f.actions.requestReschedule(f.appointment.id, '2099-09-14', '13:00'), { success: true });
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
    const result = await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00');
    assert.equal(result.success, false);
    assert.equal('code' in result && result.code, 'TOO_MANY_RESCHEDULES');
    assert.equal(!result.success && result.error, "You've asked to change this appointment several times recently. Please try again later or call the salon.");
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
  const result = await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00');
  assert.equal('code' in result && result.code, 'OUTSIDE_HOURS');
  assert.deepEqual(f.limiterKeys, [], 'only a move that can actually happen is counted');
});

test("another customer's booking cannot spend its reschedule allowance", async () => {
  const f = fixture();
  f.appointment.userId = 'someone-else';
  const result = await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00');
  assert.equal('code' in result && result.code, 'APPOINTMENT_NOT_FOUND');
  assert.deepEqual(f.limiterKeys, []);
});

test('rescheduling must fit the entire frozen duration before closing', async () => {
  const { actions, appointment } = fixture({ hoursEnd: '10:45' });
  assert.equal((await actions.requestReschedule(appointment.id, '2099-09-15', '10:00')).success, false);
});

for (const changeAfterRead of ['cancel', 'reschedule'] as const) {
  test(`rescheduling rejects a concurrent ${changeAfterRead} without overwriting it or emailing`, async () => {
    const { actions, appointment, messages } = fixture({ changeAfterRead });
    assert.equal((await actions.requestReschedule(appointment.id, '2099-09-15', '10:00')).success, false);
    assert.equal(messages.length, 0);
    assert.equal(appointment.rescheduleRequestedAt, null);
    if (changeAfterRead === 'cancel') assert.equal(appointment.status, 'CANCELLED');
    else assert.equal(appointment.date.toISOString(), '2099-09-16T09:00:00.000Z');
  });
}

test('legacy bookings without a frozen duration still use the service duration', async () => {
  const { actions, appointment } = fixture({ durationAtBooking: null, conflictingBooking: true });
  assert.equal((await actions.requestReschedule(appointment.id, '2099-09-15', '10:00')).success, true);
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

test('an unexpected cancellation failure is logged with the appointment id; an expected refusal is not', async (t) => {
  const logged = t.mock.method(console, 'error', () => undefined);
  const failing = fixture({ failEnqueue: true });
  assert.equal((await failing.actions.cancelAppointment(failing.appointment.id)).success, false);
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0].arguments[0]), /Cancelling an appointment failed/);
  assert.deepEqual(logged.mock.calls[0].arguments[1], { appointmentId: failing.appointment.id });
  assert.match(String(logged.mock.calls[0].arguments[2]), /queue write failed/);

  const stale = fixture({ status: 'PENDING', changeAfterRead: 'confirm' });
  assert.equal((await stale.actions.cancelAppointment(stale.appointment.id)).success, false);
  assert.equal(logged.mock.callCount(), 1, 'a concurrency refusal is a normal answer, not an error');
});

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
  assert.equal((await actions.requestReschedule(appointment.id, '2099-09-14', '13:30')).success, false);
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
    const moved = await move.actions.requestReschedule(move.appointment.id, '2099-09-15', '10:00');
    assert.equal(moved.success, allowed, JSON.stringify(moved));
    if (!allowed) assert.match(String(moved.error), /24 hours/);
  });
}

test('confirmed appointments retain the 24-hour change restriction while pending requests can be withdrawn', async () => {
  const currentDate = new Date(Date.now() + 60 * 60_000);
  const confirmed = fixture({ currentDate });
  assert.equal((await confirmed.actions.cancelAppointment(confirmed.appointment.id)).success, false);
  assert.equal((await confirmed.actions.requestReschedule(confirmed.appointment.id, '2099-09-15', '10:00')).success, false);
  assert.equal(confirmed.appointment.status, 'CONFIRMED');
  const pending = fixture({ status: 'PENDING', currentDate });
  assert.equal((await pending.actions.cancelAppointment(pending.appointment.id)).success, true);
  assert.equal(pending.appointment.status, 'CANCELLED');
  assert.equal(pending.messages.length, 1);
});

for (const operation of ['approve', 'admin-cancel', 'customer-cancel', 'request'] as const) {
  test(`a failed notification enqueue rolls back ${operation} without dispatching`, async (t) => {
    t.mock.method(console, 'error', () => undefined); // the failure is logged by design
    const initialStatus = operation === 'approve' ? 'PENDING' : 'CONFIRMED';
    const f = fixture({ status: initialStatus, failEnqueue: true });
    const result = operation === 'request'
      ? await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00')
      : operation === 'customer-cancel'
        ? await f.actions.cancelAppointment(f.appointment.id)
        : await f.admin.updateAppointmentStatus(f.appointment.id, operation === 'approve' ? 'CONFIRMED' : 'CANCELLED');
    assert.equal(result.success, false);
    assert.equal(f.appointment.status, initialStatus);
    assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
    assert.equal(f.appointment.notificationVersion, 0);
    assert.equal(f.appointment.reminderSent, true);
    assert.equal(f.appointment.rescheduleRequestedAt, null);
    assert.equal(f.events.length, 0);
    assert.equal(f.messages.length, 0);
    assert.equal(f.dispatches(), 0);
  });
}

test('rescheduling rechecks readiness in the transaction even when the earlier public check passed', async () => {
  const f = fixture({ onlineReady: false });
  const result = await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00');
  assert.equal(result.success, false);
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
  assert.equal(f.appointment.rescheduleRequestedAt, null);
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

test('approving a new booking runs the shared pre-approval refresh for its stylist', async () => {
  const refreshed: string[] = [];
  const f = fixture({ status: 'PENDING', onFeedRefresh: (stylistId) => refreshed.push(stylistId) });
  assert.equal((await f.admin.updateAppointmentStatus(f.appointment.id, 'CONFIRMED')).success, true);
  assert.deepEqual(refreshed, ['stylist-1']);
});

test('a request leaves the booking confirmed at its original time and emails the customer and the salon', async () => {
  const f = fixture();
  assert.deepEqual(await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00'), { success: true });
  assert.equal(f.appointment.status, 'CONFIRMED');
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
  assert.equal(f.appointment.rescheduleRequestedDate?.toISOString(), '2099-09-15T09:00:00.000Z');
  assert.ok(f.appointment.rescheduleRequestedAt);
  assert.equal(f.appointment.notificationVersion, 0, 'a request never bumps the event version');
  assert.equal(f.appointment.reminderSent, true, 'the reminder for the original time stays valid');
  assert.deepEqual(f.events.map((event) => event.kind).sort(), ['RESCHEDULE_REQUEST_RECEIVED', 'SALON_RESCHEDULE_ALERT']);
  assert.equal(f.dispatches(), 1);
});

test('a requested time less than 24 hours away is refused before any transaction', async () => {
  const f = fixture();
  // Mocked now is 2099-09-01T12:00Z; 13:00 BST on 2 Sep is 12:00Z — exactly 24 h, allowed; 12:59 BST is not.
  const tooSoon = await f.actions.requestReschedule(f.appointment.id, '2099-09-02', '12:59');
  assert.equal('code' in tooSoon && tooSoon.code, 'RESCHEDULE_REQUEST_TOO_SOON');
  assert.equal(f.transactions(), 0);
  assert.deepEqual(f.limiterKeys, []);
});

test('a requested time on the stylist\'s day off is refused', async () => {
  const f = fixture({ offDays: [3] });
  const result = await f.actions.requestReschedule(f.appointment.id, '2099-09-16', '10:00'); // Wednesday
  assert.equal('code' in result && result.code, 'STYLIST_OFF_THAT_DAY');
  assert.equal(f.appointment.rescheduleRequestedAt, null);
  // Refused up front, on the requested weekday: no transaction, no allowance spent.
  assert.equal(f.transactions(), 0);
  assert.deepEqual(f.limiterKeys, []);
});

test('a colour booking cannot be requested into the 48 hours after its patch test', async () => {
  const f = fixture({ requiresPatchTest: true, patchTestDate: new Date('2099-09-14T12:00:00Z') });
  const result = await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00');
  assert.equal('code' in result && result.code, 'PATCH_TEST_TOO_SOON');
  assert.equal(f.appointment.rescheduleRequestedAt, null);
});

test('asking again for the time already requested sends nothing', async () => {
  const f = fixture({ openRequest: { requestedDate: new Date('2099-09-15T09:00:00Z'), requestedAt: new Date('2099-09-01T11:00:00Z') } });
  assert.deepEqual(await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00'), { success: true });
  assert.equal(f.transactions(), 0);
  assert.equal(f.events.length, 0);
  assert.deepEqual(f.limiterKeys, []);
});

test('a new time replaces the open request with fresh emails', async () => {
  const f = fixture({ openRequest: { requestedDate: new Date('2099-09-15T09:00:00Z'), requestedAt: new Date('2099-08-31T11:00:00Z') } });
  assert.equal((await f.actions.requestReschedule(f.appointment.id, '2099-09-16', '10:00')).success, true);
  assert.equal(f.appointment.rescheduleRequestedDate?.toISOString(), '2099-09-16T09:00:00.000Z');
  assert.notEqual(f.appointment.rescheduleRequestedAt?.toISOString(), '2099-08-31T11:00:00.000Z');
  assert.equal(f.events.length, 2);
  assert.ok(f.events.every((event) => event.eventKey.endsWith(f.appointment.rescheduleRequestedAt!.toISOString())));
});

test('an expired request that the cron has not cleared yet can be replaced', async () => {
  // Requested time 2099-09-02T09:00Z is under 24 h from the mocked now.
  const f = fixture({ openRequest: { requestedDate: new Date('2099-09-02T09:00:00Z'), requestedAt: new Date('2099-08-30T11:00:00Z') } });
  assert.equal((await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00')).success, true);
  assert.equal(f.appointment.rescheduleRequestedDate?.toISOString(), '2099-09-15T09:00:00.000Z');
});

test('a double-submitted request that lost the race is refused and sends nothing', async () => {
  // The other submission commits between this one's read and its transaction.
  const f = fixture({ changeAfterRead: 'request' });
  const result = await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00');
  assert.equal('code' in result && result.code, 'RESCHEDULE_REQUEST_CHANGED');
  assert.equal(f.events.length, 0, 'never a second pair of emails');
  assert.equal(f.appointment.rescheduleRequestedAt?.toISOString(), '2099-09-01T11:30:00.000Z', 'the winner is kept');
});

test('a double-submit after the first committed is a silent no-op', async () => {
  const f = fixture();
  assert.equal((await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00')).success, true);
  assert.deepEqual(await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00'), { success: true });
  assert.equal(f.events.length, 2, 'one pair of emails in total');
});

test('withdrawing clears the request without email, even while online booking is closed', async () => {
  const f = fixture({ onlineReady: false, openRequest: { requestedDate: new Date('2099-09-15T09:00:00Z'), requestedAt: new Date('2099-09-01T11:00:00Z') } });
  assert.deepEqual(await f.actions.withdrawRescheduleRequest(f.appointment.id), { success: true });
  assert.equal(f.appointment.rescheduleRequestedAt, null);
  assert.equal(f.appointment.rescheduleRequestedDate, null);
  assert.equal(f.events.length, 0);
});

test('only the booking\'s owner can withdraw its request', async () => {
  const f = fixture({ openRequest: { requestedDate: new Date('2099-09-15T09:00:00Z'), requestedAt: new Date('2099-09-01T11:00:00Z') } });
  f.appointment.userId = 'someone-else';
  const result = await f.actions.withdrawRescheduleRequest(f.appointment.id);
  assert.equal('code' in result && result.code, 'APPOINTMENT_NOT_FOUND');
  assert.ok(f.appointment.rescheduleRequestedAt);
});

test('cancelling a booking also clears its open request', async () => {
  const f = fixture({ openRequest: { requestedDate: new Date('2099-09-15T09:00:00Z'), requestedAt: new Date('2099-09-01T11:00:00Z') } });
  assert.equal((await f.actions.cancelAppointment(f.appointment.id)).success, true);
  assert.equal(f.appointment.status, 'CANCELLED');
  assert.equal(f.appointment.rescheduleRequestedAt, null);
});

const OPEN_REQUEST = { requestedDate: new Date('2099-09-15T09:00:00Z'), requestedAt: new Date('2099-09-01T11:00:00Z') };

test('approval moves the booking to the requested time, keeps frozen price/duration and bumps the version once', async () => {
  const f = fixture({ openRequest: OPEN_REQUEST });
  assert.deepEqual(await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString()), { success: true });
  assert.equal(f.appointment.date.toISOString(), '2099-09-15T09:00:00.000Z');
  assert.equal(f.appointment.rescheduleRequestedAt, null);
  assert.equal(f.appointment.rescheduleRequestedDate, null);
  assert.equal(f.appointment.reminderSent, false);
  assert.equal(f.appointment.notificationVersion, 1);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].eventKey, 'appointment/appointment-1/1/RESCHEDULE');
  const payload = JSON.parse(f.events[0].payloadJson);
  assert.equal(payload.options.oldDate, '2099-09-14T12:00:00.000Z');
  assert.equal(payload.appointment.price.amountPence, 8000);
  assert.equal(payload.appointment.service.duration, 60);
});

test('approval refreshes the stylist\'s Fresha feeds before the readiness check', async () => {
  const trace: string[] = [];
  const refreshed: string[] = [];
  const f = fixture({ openRequest: OPEN_REQUEST, trace, onFeedRefresh: (stylistId) => refreshed.push(stylistId) });
  assert.equal((await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString())).success, true);
  assert.deepEqual(trace, ['refresh', 'readiness']);
  assert.deepEqual(refreshed, ['stylist-1'], 'the same shared helper as new-booking approval');
});

test('declining a request fetches no marketplace feeds', async () => {
  const trace: string[] = [];
  const f = fixture({ openRequest: OPEN_REQUEST, trace });
  assert.equal((await f.admin.decideRescheduleRequest(f.appointment.id, 'DECLINE', OPEN_REQUEST.requestedAt.toISOString())).success, true);
  assert.deepEqual(trace, []);
});

test('approve updates the busy feed before waiting for email delivery', async () => {
  await assertFeedInvalidatesBeforeDelivery((hooks) => {
    const f = fixture({ ...hooks, openRequest: OPEN_REQUEST });
    return f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString());
  });
});

test('a requested slot taken since the request keeps the request open and tells staff', async () => {
  const f = fixture({ openRequest: OPEN_REQUEST, conflictingBooking: true });
  const result = await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString());
  assert.equal(result.success, false);
  assert.match(String(!result.success && result.error), /no longer free/);
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
  assert.ok(f.appointment.rescheduleRequestedAt, 'staff can still decline it');
  assert.equal(f.events.length, 0);
});

test('hours edited after the request make approval fail with OUTSIDE_HOURS and leave the request open', async () => {
  const f = fixture({ openRequest: OPEN_REQUEST, hoursEnd: '09:30' });
  const result = await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString());
  assert.equal(result.success, false);
  assert.equal(!result.success && result.error, 'Selected time is outside business hours');
  assert.equal(f.appointment.rescheduleRequestedAt?.toISOString(), OPEN_REQUEST.requestedAt.toISOString(), 'staff can still decline it');
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
  assert.equal(f.events.length, 0);
});

test('a decision on a request that has since changed is refused', async () => {
  const f = fixture({ openRequest: OPEN_REQUEST });
  const result = await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', '2099-09-01T10:00:00.000Z');
  assert.equal(result.success, false);
  assert.match(String(!result.success && result.error), /changed/);
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
});

test('an expired request cannot be approved', async () => {
  const expired = { requestedDate: new Date('2099-09-02T09:00:00Z'), requestedAt: new Date('2099-08-30T11:00:00Z') };
  const f = fixture({ openRequest: expired });
  const result = await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', expired.requestedAt.toISOString());
  assert.equal(result.success, false);
  assert.match(String(!result.success && result.error), /expired/);
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
});

test('a request on a booking whose original time has passed cannot be approved', async () => {
  // The visit was an hour ago (mocked now 2099-09-01T12:00Z); the requested time is days away.
  const f = fixture({ openRequest: OPEN_REQUEST, currentDate: new Date('2099-09-01T11:00:00Z') });
  const result = await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString());
  assert.equal(result.success, false);
  // The requested time is days away, so the message must not blame it alone,
  // and it must tell staff what they can still do.
  assert.match(String(!result.success && result.error), /expired/);
  assert.match(String(!result.success && result.error), /original appointment has already passed/);
  assert.match(String(!result.success && result.error), /Decline the request or call the customer/);
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
  assert.equal(f.appointment.rescheduleRequestedAt?.toISOString(), OPEN_REQUEST.requestedAt.toISOString(), 'the request is left for the lapse step');
  assert.equal(f.appointment.notificationVersion, 0);
  assert.equal(f.events.length, 0);
});

test('decline keeps the original time, clears the request and emails the customer', async () => {
  const f = fixture({ openRequest: OPEN_REQUEST });
  assert.deepEqual(await f.admin.decideRescheduleRequest(f.appointment.id, 'DECLINE', OPEN_REQUEST.requestedAt.toISOString()), { success: true });
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
  assert.equal(f.appointment.rescheduleRequestedAt, null);
  assert.equal(f.appointment.notificationVersion, 0);
  assert.deepEqual(f.events.map((event) => event.kind), ['RESCHEDULE_DECLINED']);
});

test('only admins can decide a reschedule request', async () => {
  const f = fixture({ openRequest: OPEN_REQUEST, role: 'USER' });
  const result = await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString());
  assert.equal(result.success, false);
  assert.ok(f.appointment.rescheduleRequestedAt);
  assert.equal(f.transactions(), 0);
});

for (const status of ['CANCELLED', 'COMPLETED'] as const) {
  test(`staff marking a booking ${status} also clears its open request`, async () => {
    const f = fixture({ openRequest: OPEN_REQUEST });
    assert.equal((await f.admin.updateAppointmentStatus(f.appointment.id, status)).success, true);
    assert.equal(f.appointment.rescheduleRequestedAt, null);
    assert.equal(f.events.some((event) => event.kind === 'RESCHEDULE_DECLINED' || event.kind === 'RESCHEDULE_LAPSED'), false);
  });
}

test('approval refuses a requested day the stylist no longer works', async () => {
  // The rota changed after the request: the stylist is now off on Tuesdays (OPEN_REQUEST is Tue 15 Sep).
  const f = fixture({ openRequest: OPEN_REQUEST, offDays: [2] });
  const result = await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString());
  assert.equal(result.success, false);
  assert.match(String(!result.success && result.error), /not available on this day/);
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
  assert.equal(f.appointment.rescheduleRequestedAt?.toISOString(), OPEN_REQUEST.requestedAt.toISOString(), 'staff can still decline it');
  assert.equal(f.events.length, 0);
});

test('the colour patch-test rule is re-checked against the requested date on approval', async () => {
  const f = fixture({ openRequest: OPEN_REQUEST, requiresPatchTest: true, patchTestDate: new Date('2099-09-14T12:00:00Z') });
  const result = await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString());
  assert.equal(result.success, false);
  assert.equal(!result.success && result.error, 'Your patch test must be at least 48 hours before a colour appointment.');
  assert.equal(f.appointment.rescheduleRequestedAt?.toISOString(), OPEN_REQUEST.requestedAt.toISOString(), 'staff can still decline it');
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
  assert.equal(f.events.length, 0);
});

test('a declined request\'s email carries the salon phone from settings, and none without a settings row', async () => {
  const withPhone = fixture({ openRequest: OPEN_REQUEST, salonPhone: '07831 830898' });
  assert.equal((await withPhone.admin.decideRescheduleRequest(withPhone.appointment.id, 'DECLINE', OPEN_REQUEST.requestedAt.toISOString())).success, true);
  assert.equal(JSON.parse(withPhone.events[0].payloadJson).options.salonPhone, '07831 830898');
  const without = fixture({ openRequest: OPEN_REQUEST });
  assert.equal((await without.admin.decideRescheduleRequest(without.appointment.id, 'DECLINE', OPEN_REQUEST.requestedAt.toISOString())).success, true);
  assert.equal(JSON.parse(without.events[0].payloadJson).options.salonPhone, undefined);
});

test('every reschedule-request audit event records the request it is about', async () => {
  const original = '2099-09-14T12:00:00.000Z';
  const requested = OPEN_REQUEST.requestedDate.toISOString();
  const openAt = OPEN_REQUEST.requestedAt.toISOString();
  // Date is mocked, so a new request's requestedAt is exactly "now".
  const now = new Date().toISOString();

  const asked = fixture();
  assert.equal((await asked.actions.requestReschedule(asked.appointment.id, '2099-09-15', '10:00')).success, true);
  assert.deepEqual(asked.audits, [{ action: 'APPOINTMENT.RESCHEDULE_REQUESTED', metadata: { from: original, to: requested, requestedAt: now } }]);

  const replaced = fixture({ openRequest: OPEN_REQUEST });
  assert.equal((await replaced.actions.requestReschedule(replaced.appointment.id, '2099-09-16', '10:00')).success, true);
  assert.deepEqual(replaced.audits, [{ action: 'APPOINTMENT.RESCHEDULE_REPLACED', metadata: { from: original, to: '2099-09-16T09:00:00.000Z', requestedAt: now } }]);

  const withdrawn = fixture({ openRequest: OPEN_REQUEST });
  assert.equal((await withdrawn.actions.withdrawRescheduleRequest(withdrawn.appointment.id)).success, true);
  assert.deepEqual(withdrawn.audits, [{ action: 'APPOINTMENT.RESCHEDULE_WITHDRAWN', metadata: { from: original, to: requested, requestedAt: openAt } }]);

  for (const [decision, action] of [['APPROVE', 'APPOINTMENT.RESCHEDULE_APPROVED'], ['DECLINE', 'APPOINTMENT.RESCHEDULE_DECLINED']] as const) {
    const f = fixture({ openRequest: OPEN_REQUEST });
    assert.equal((await f.admin.decideRescheduleRequest(f.appointment.id, decision, openAt)).success, true);
    assert.deepEqual(f.audits, [{ action, metadata: { from: original, to: requested, requestedAt: openAt } }]);
  }
});
