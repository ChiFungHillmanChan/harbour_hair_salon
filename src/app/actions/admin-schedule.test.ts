import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { assertFeedInvalidatesBeforeDelivery, type NotificationTimingHooks } from '../../test/stalled-notification';

// The appointment under test sits at 10:00 salon-local on 2099-09-15 (BST).
const ORIGINAL_START = new Date('2099-09-15T09:00:00Z');
const ORIGINAL_UPDATED_AT = new Date('2099-09-01T00:00:00Z');

type Row = Record<string, unknown>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (!(key in row)) return true;
    const actual = row[key];
    if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
    if (expected && typeof expected === 'object') {
      const filter = expected as Row;
      if ('not' in filter) return actual !== filter.not;
      if ('gte' in filter && (actual as Date) < (filter.gte as Date)) return false;
      if ('lte' in filter && (actual as Date) > (filter.lte as Date)) return false;
      return true;
    }
    return actual === expected;
  });
}

function fixture(options: {
  role?: string;
  status?: string;
  conflicting?: boolean;
  requiresPatchTest?: boolean;
  openRequest?: boolean;
} & NotificationTimingHooks = {}) {
  const appointment = {
    id: 'appt-1',
    userId: 'user-1',
    stylistId: 'stylist-1',
    serviceId: 'service-1',
    date: ORIGINAL_START,
    status: options.status ?? 'CONFIRMED',
    durationAtBooking: 60,
    priceAtBooking: 80,
    reminderSent: true,
    rescheduleRequestedDate: (options.openRequest ? new Date('2099-09-20T09:00:00Z') : null) as Date | null,
    rescheduleRequestedAt: (options.openRequest ? new Date('2099-09-01T11:00:00Z') : null) as Date | null,
    notificationVersion: 0,
    notes: null,
    updatedAt: ORIGINAL_UPDATED_AT,
    treatwellBookingId: null,
    user: { name: 'Sarah W.', email: 'sarah@example.test', phone: null },
    stylist: { name: 'Ivan', treatwellExternalId: null },
    service: { name: 'Full Colour', duration: 60, price: 80, requiresPatchTest: options.requiresPatchTest ?? false, treatwellExternalId: null },
  };

  const writes: Row[] = [];
  const clashChecksInTransaction: boolean[] = [];
  let transactionActive = false;
  let dispatches = 0;
  const enqueued: { kind: string; oldDate?: string; requestedDate?: string }[] = [];

  const otherBooking = {
    id: 'other', stylistId: 'stylist-1', status: 'CONFIRMED',
    date: new Date('2099-09-15T10:00:00Z'), durationAtBooking: 60,
    user: { name: 'Mei L.' }, service: { duration: 60 },
  };

  const tx = {
    appointment: {
      findUnique: async () => structuredClone(appointment),
      findMany: async ({ where }: { where: Row }) => {
        if (where && 'service' in where) return []; // patch-test history: none on file
        clashChecksInTransaction.push(transactionActive);
        return (options.conflicting ? [otherBooking] : []).filter((row) => matches(row, where));
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (!matches(appointment, where)) return { count: 0 };
        writes.push(data);
        for (const [key, value] of Object.entries(data)) {
          const record = appointment as unknown as Row;
          record[key] = value && typeof value === 'object' && 'increment' in (value as Row)
            ? Number(record[key]) + Number((value as Row).increment)
            : value;
        }
        return { count: 1 };
      },
    },
    // Only read when an edit changes the service (quoteForNewBooking).
    service: {
      findUnique: async ({ where }: { where: { id: string } }) => where.id === 'service-2' ? {
        id: 'service-2', name: 'Blow Dry', price: 40, duration: 45, offeringId: null, hairLength: null,
        priceType: 'STANDARD', priceVersion: 3, vatDisplay: 'EXCLUDED', priceNature: 'LISTED', durationConfirmed: true,
        surchargeBaseServiceId: null, surchargeAmount: null, priceSource: 'treatwell:2026-09-28', isPublic: true,
        isBookable: true, requiresPatchTest: false, requiresConsultation: false, isConsultation: false, isPatchTest: false,
        treatwellExternalId: null,
      } : null,
    },
    availability: { findFirst: async () => ({ startTime: '09:00', endTime: '18:00' }) },
    externalBusyBlock: { findMany: async () => [] },
  };

  const db = {
    ...tx,
    $transaction: async (fn: (client: unknown) => Promise<unknown>) => {
      transactionActive = true;
      try {
        return await fn(tx);
      } finally {
        transactionActive = false;
      }
    },
  };

  const queue = {
    enqueueAppointmentNotification: async (client: unknown, kind: string, _appt: unknown, opts?: { oldDate?: Date; requestedDate?: Date }) => {
      assert.equal(client, tx, 'enqueue must use the appointment transaction client');
      assert.equal(transactionActive, true, 'enqueue must happen before commit');
      enqueued.push({ kind, oldDate: opts?.oldDate?.toISOString(), ...(opts?.requestedDate ? { requestedDate: opts.requestedDate.toISOString() } : {}) });
      return { id: `event-${enqueued.length}` };
    },
    dispatchAppointmentNotifications: async () => {
      assert.equal(transactionActive, false, 'delivery must start after commit');
      dispatches++;
      await options.onDispatch?.();
    },
  };

  const bookingService = loadServerModule<typeof import('../services/booking-service')>(
    'src/app/services/booking-service.ts',
    {
      '@/app/lib/prisma': db,
      './offers-service': { getActiveGlobalOffer: async () => null },
      '@/app/lib/booking-maintenance': { assertOnlineBookingReady: async () => ({ phone: '', bookingEnabled: true }) },
      './notification-outbox-service': queue,
    },
  );

  const actions = loadServerModule<typeof import('./admin-schedule')>('src/app/actions/admin-schedule.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: options.role ?? 'ADMIN' }) },
    '@/app/services/booking-service': bookingService,
    '@/app/services/notification-outbox-service': queue,
    '@/app/services/treatwell-api': {
      getTreatwellApiConfiguration: () => ({ enabled: false, configured: false }),
      changedTreatwellSyncStatus: () => 'NOT_REQUIRED',
    },
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

  return { appointment, actions, writes, enqueued, clashChecksInTransaction, dispatches: () => dispatches };
}

const move = (overrides: Partial<Parameters<typeof import('./admin-schedule').moveAppointmentByAdmin>[0]> = {}) => ({
  appointmentId: 'appt-1',
  dateStr: '2099-09-15',
  time: '11:00',
  durationMin: 60,
  stylistId: 'stylist-1',
  overrideClashes: false,
  expectedUpdatedAt: ORIGINAL_UPDATED_AT.toISOString(),
  ...overrides,
});

test('a direct staff move clears any open customer reschedule request', async () => {
  const { actions, appointment } = fixture({ openRequest: true });
  assert.deepEqual(await actions.moveAppointmentByAdmin(move()), { success: true });
  assert.equal(appointment.rescheduleRequestedAt, null);
  assert.equal(appointment.rescheduleRequestedDate, null);
});

test('a staff move that closes an open request tells the customer which request it replaced', async () => {
  const { actions, enqueued } = fixture({ openRequest: true });
  assert.deepEqual(await actions.moveAppointmentByAdmin(move()), { success: true });
  assert.deepEqual(enqueued, [{ kind: 'RESCHEDULE', oldDate: ORIGINAL_START.toISOString(), requestedDate: '2099-09-20T09:00:00.000Z' }]);
});

test('a staff move with no open request mentions no request', async () => {
  const { actions, enqueued } = fixture();
  assert.deepEqual(await actions.moveAppointmentByAdmin(move()), { success: true });
  assert.deepEqual(enqueued, [{ kind: 'RESCHEDULE', oldDate: ORIGINAL_START.toISOString() }]);
});

test('changing only the duration keeps an open customer request', async () => {
  const { actions, appointment } = fixture({ openRequest: true });
  assert.deepEqual(await actions.moveAppointmentByAdmin(move({ time: '10:00', durationMin: 90 })), { success: true });
  assert.ok(appointment.rescheduleRequestedAt);
});

test('an admin move updates the busy feed before waiting for reschedule delivery', async () => {
  await assertFeedInvalidatesBeforeDelivery((hooks) => fixture(hooks).actions.moveAppointmentByAdmin(move()));
});

test('a clean move writes the new start, duration and stylist', async () => {
  const { actions, appointment, writes } = fixture();

  const result = await actions.moveAppointmentByAdmin(move({ durationMin: 90, stylistId: 'stylist-2' }));

  assert.deepEqual(result, { success: true });
  assert.equal(writes.length, 1);
  assert.equal(appointment.date.toISOString(), '2099-09-15T10:00:00.000Z', '11:00 BST is 10:00Z');
  assert.equal(appointment.durationAtBooking, 90);
  assert.equal(appointment.stylistId, 'stylist-2');
  assert.equal(appointment.notificationVersion, 1);
});

test('a resize never touches the price', async () => {
  // Stretching a 3-hour colour must not silently re-bill the customer.
  const { actions, appointment, writes } = fixture();

  await actions.moveAppointmentByAdmin(move({ durationMin: 240 }));

  assert.equal(appointment.priceAtBooking, 80);
  assert.ok(!('priceAtBooking' in writes[0]), 'priceAtBooking must never be written');
});

test('moving the date clears the sent-reminder flag', async () => {
  const { actions, appointment } = fixture();

  await actions.moveAppointmentByAdmin(move());

  assert.equal(appointment.reminderSent, false, 'the old reminder no longer describes this booking');
});

test('a clash without override returns the clash and writes nothing', async () => {
  const { actions, appointment, writes } = fixture({ conflicting: true });

  const result = await actions.moveAppointmentByAdmin(move());

  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok('clashes' in result && result.clashes.length === 1);
  assert.equal(result.clashes[0].kind, 'OVERLAP');
  assert.equal(writes.length, 0, 'nothing may be written on the warn path');
  assert.equal(appointment.date.toISOString(), ORIGINAL_START.toISOString());
});

test('the same move with override writes', async () => {
  const { actions, appointment, writes } = fixture({ conflicting: true });

  const result = await actions.moveAppointmentByAdmin(move({ overrideClashes: true }));

  assert.deepEqual(result, { success: true });
  assert.equal(writes.length, 1);
  assert.equal(appointment.date.toISOString(), '2099-09-15T10:00:00.000Z');
});

test('the clash check still runs inside the transaction on the override path', async () => {
  // Override changes whether a clash ABORTS the write — never whether the write
  // is serializable. Skipping the check here would reopen the double-booking
  // race that Serializable isolation exists to close.
  const { actions, clashChecksInTransaction } = fixture({ conflicting: true });

  await actions.moveAppointmentByAdmin(move({ overrideClashes: true }));

  assert.ok(clashChecksInTransaction.length > 0, 'the clash scan must run');
  assert.ok(
    clashChecksInTransaction.every(Boolean),
    'every clash scan must use the transaction client, override or not',
  );
});

test('a stale expectedUpdatedAt is refused rather than overwriting', async () => {
  // The board auto-refreshes every 60s, so an admin can easily drag a block
  // another admin has already moved.
  const { actions, appointment, writes } = fixture();

  const result = await actions.moveAppointmentByAdmin(
    move({ expectedUpdatedAt: new Date('2099-09-02T00:00:00Z').toISOString() }),
  );

  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok('error' in result && /refresh/i.test(result.error));
  assert.equal(writes.length, 0);
  assert.equal(appointment.date.toISOString(), ORIGINAL_START.toISOString());
});

test('changing only the duration sends no email', async () => {
  // The customer still arrives at 10:00, so nothing about their plan changed.
  const { actions, enqueued, appointment } = fixture();

  await actions.moveAppointmentByAdmin(move({ time: '10:00', durationMin: 120 }));

  assert.equal(appointment.durationAtBooking, 120);
  assert.equal(appointment.notificationVersion, 0, 'silent resizing must not invalidate pending confirmation/reminder deliveries');
  assert.deepEqual(enqueued, []);
});

test('changing the start time on a confirmed booking sends exactly one reschedule email', async () => {
  const { actions, enqueued, dispatches } = fixture();

  await actions.moveAppointmentByAdmin(move({ time: '14:00' }));

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].kind, 'RESCHEDULE');
  assert.equal(enqueued[0].oldDate, ORIGINAL_START.toISOString(), 'the email needs the time it moved from');
  assert.equal(dispatches(), 1);
});

test('changing the stylist on a confirmed booking sends a reschedule email', async () => {
  const { actions, enqueued } = fixture();

  await actions.moveAppointmentByAdmin(move({ time: '10:00', stylistId: 'stylist-2' }));

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].kind, 'RESCHEDULE');
});

test('re-servicing a confirmed booking at the price shown records it and tells the customer once', async () => {
  const { actions, appointment, enqueued, writes } = fixture();

  const result = await actions.editAppointmentByAdmin({
    ...move({ time: '10:00' }),
    serviceId: 'service-2',
    expectedQuote: { serviceId: 'service-2', priceVersion: 3, amountPence: 4000 },
  });

  assert.deepEqual(result, { success: true });
  assert.equal(appointment.serviceId, 'service-2');
  assert.equal(writes[0].priceAtBooking, '40.00');
  assert.equal(JSON.parse(writes[0].quoteJson as string).vatDisplay, 'EXCLUDED');
  assert.equal(appointment.notificationVersion, 1);
  assert.deepEqual(enqueued.map((event) => event.kind), ['RESCHEDULE']);
});

test('moving a pending request replaces its stale receipt and salon alert without confirming it', async () => {
  const { actions, enqueued, appointment } = fixture({ status: 'PENDING' });

  const result = await actions.moveAppointmentByAdmin(move({ time: '14:00' }));

  assert.deepEqual(result, { success: true });
  assert.equal(appointment.date.toISOString(), '2099-09-15T13:00:00.000Z');
  assert.deepEqual(enqueued.map((event) => event.kind), ['REQUEST_RECEIVED', 'SALON_ALERT']);
  assert.equal(appointment.status, 'PENDING');
  assert.equal(appointment.notificationVersion, 1);
});

test('a non-admin session is rejected before anything is read', async () => {
  const { actions, writes } = fixture({ role: 'USER' });

  const result = await actions.moveAppointmentByAdmin(move());

  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok('error' in result);
  assert.equal(writes.length, 0);
});

test('a malformed date or time is refused', async () => {
  const { actions, writes } = fixture();

  for (const bad of [{ dateStr: '15/09/2099' }, { time: '25:00' }, { time: '9am' }]) {
    const result = await actions.moveAppointmentByAdmin(move(bad));
    assert.equal(result.success, false, `${JSON.stringify(bad)} should be refused`);
  }
  assert.equal(writes.length, 0);
});

test('a duration below the grid minimum is refused', async () => {
  const { actions, writes } = fixture();

  const result = await actions.moveAppointmentByAdmin(move({ durationMin: 5 }));

  assert.equal(result.success, false);
  assert.equal(writes.length, 0);
});
