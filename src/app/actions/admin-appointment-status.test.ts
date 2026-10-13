import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { bookingErrorText } from '../services/booking-errors';

// Staff status changes on the admin board (actions/admin.ts updateAppointmentStatus):
// what may happen before / after an appointment's start time, and what the
// customer is told. Date is mocked, so "started" boundaries are exact.
const NOW = new Date('2099-09-01T12:00:00Z');
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);
before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

type FixtureOptions = {
  status?: string; date?: Date; role?: 'ADMIN' | 'USER';
  /** The request was announced to the customer: its REQUEST_RECEIVED notice was queued (a staff pencil-in has none). */
  announced?: boolean;
  salonPhone?: string;
  settingsReadFails?: boolean;
};

function fixture(options: FixtureOptions = {}) {
  const appointment = {
    id: 'appointment-1', userId: 'user-1', stylistId: 'stylist-1', serviceId: 'service-1',
    date: options.date ?? minutes(13 * 24 * 60), status: options.status ?? 'CONFIRMED',
    durationAtBooking: 60, priceAtBooking: 80, notificationVersion: 0, notes: null,
    updatedAt: new Date('2099-08-01T00:00:00Z'), treatwellBookingId: null,
    rescheduleRequestedDate: null as Date | null, rescheduleRequestedAt: null as Date | null,
    user: { email: 'customer@example.test', name: 'Customer' },
    stylist: { name: 'Stylist', treatwellExternalId: null },
    service: { name: 'Cut', price: 80, duration: 60, treatwellExternalId: null },
  };
  const enqueued: string[] = [];
  const queued: { kind: string; version: number; options: Record<string, unknown> }[] = [];
  const audits: { action: string; metadata: Record<string, unknown> }[] = [];
  const counts = { dispatches: 0, invalidations: 0, slotChecks: 0, refreshes: 0, writes: 0, settingsReads: 0 };
  const tx = {
    appointment: {
      findUnique: async (args: { select?: Record<string, unknown> }) =>
        args.select ? { stylistId: appointment.stylistId, date: appointment.date } : structuredClone(appointment),
      updateMany: async ({ where, data }: { where: { status: string; date: Date }; data: Record<string, unknown> }) => {
        counts.writes++;
        if (where.status !== appointment.status || where.date.getTime() !== appointment.date.getTime()) return { count: 0 };
        for (const [key, value] of Object.entries(data)) {
          const record = appointment as unknown as Record<string, unknown>;
          record[key] = value && typeof value === 'object' && 'increment' in value ? Number(record[key]) + Number(value.increment) : value;
        }
        return { count: 1 };
      },
    },
    notificationDelivery: {
      findFirst: async ({ where }: { where: { appointmentId: string; kind: string } }) =>
        options.announced && where.appointmentId === appointment.id && where.kind === 'REQUEST_RECEIVED' ? { id: 'request-received' } : null,
    },
    siteSettings: { findUnique: async () => {
      counts.settingsReads++;
      if (options.settingsReadFails) throw new Error('settings read failed');
      return options.salonPhone ? { phone: options.salonPhone } : null;
    } },
    auditEvent: { create: async ({ data }: { data: { action: string; metadataJson: string } }) => {
      audits.push({ action: data.action, metadata: JSON.parse(data.metadataJson) });
      return { id: 'audit' };
    } },
  };
  const db = { ...tx, $transaction: async (fn: (client: unknown) => unknown) => fn(tx) };
  const admin = loadServerModule<typeof import('./admin')>('src/app/actions/admin.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: options.role ?? 'ADMIN' }) },
    '@/app/services/booking-service': {
      runSerializableWithRetry: async (fn: (client: unknown) => unknown) => db.$transaction(fn),
      assertAppointmentSlotAvailable: async () => { counts.slotChecks++; },
      getValidPatchTest: async () => ({ ok: true }),
    },
    '@/app/services/notification-outbox-service': {
      enqueueAppointmentNotification: async (_db: unknown, kind: string, queuedFor: { notificationVersion: number }, notice: Record<string, unknown> = {}) => {
        enqueued.push(kind);
        queued.push({ kind, version: queuedFor.notificationVersion, options: notice });
        return { id: kind };
      },
      dispatchAppointmentNotifications: async () => { counts.dispatches++; },
    },
    '@/app/services/integration-readiness': { checkCalendarBookingReadiness: async () => ({ ready: true, blockers: [] }) },
    '@/app/services/calendar-sync-service': { refreshCalendarFeedsBeforeApproval: async () => { counts.refreshes++; return []; } },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => { counts.invalidations++; } },
    '@/app/actions/admin-services': { revalidateCategoryPages: async () => undefined },
    'next/cache': { revalidatePath: () => undefined, updateTag: () => undefined },
    'next/server': { after: (callback: () => unknown) => callback() },
  });
  return { admin, appointment, enqueued, queued, audits, counts };
}

const text = (code: Parameters<typeof bookingErrorText>[1]) => bookingErrorText('en-GB', code);

test('a booking that has not started cannot be marked completed', async () => {
  for (const date of [minutes(1), minutes(13 * 24 * 60)]) {
    const f = fixture({ date });
    assert.deepEqual(await f.admin.updateAppointmentStatus(f.appointment.id, 'COMPLETED'), { success: false, error: text('COMPLETE_BEFORE_START') });
    assert.equal(f.appointment.status, 'CONFIRMED');
    assert.equal(f.counts.writes, 0);
    assert.deepEqual(f.audits, []);
    assert.equal(f.counts.invalidations, 0);
  }
});

test('a booking can be marked completed once its start time has come, even while it is still running', async () => {
  for (const date of [NOW, minutes(-30), minutes(-3 * 24 * 60)]) {
    const f = fixture({ date });
    assert.deepEqual(await f.admin.updateAppointmentStatus(f.appointment.id, 'COMPLETED'), { success: true });
    assert.equal(f.appointment.status, 'COMPLETED');
    assert.deepEqual(f.audits.map((audit) => audit.action), ['APPOINTMENT.STATUS']);
    assert.deepEqual(f.enqueued, [], 'completing a visit sends nothing');
    assert.equal(f.counts.dispatches, 0);
    assert.equal(f.counts.invalidations, 1, 'the busy feed is refreshed after the change');
  }
});

// A request is only closed once its appointment has ended (pending-request-lapse.ts);
// until then a customer who came in — often a staff pencil-in — can be marked
// completed, which keeps the chair in the busy feed until the end.
test('a booking request that has started can be marked completed, and the customer is sent nothing', async () => {
  for (const date of [NOW, minutes(-30), minutes(-3 * 24 * 60)]) {
    const f = fixture({ status: 'PENDING', date, announced: true });
    assert.deepEqual(await f.admin.updateAppointmentStatus(f.appointment.id, 'COMPLETED'), { success: true });
    assert.equal(f.appointment.status, 'COMPLETED');
    assert.equal(f.appointment.notificationVersion, 1, 'queued request mail is retired');
    assert.deepEqual(f.enqueued, []);
    assert.equal(f.counts.dispatches, 0);
    assert.equal(f.counts.slotChecks + f.counts.refreshes, 0, 'no availability work: nothing is being confirmed');
    assert.deepEqual(f.audits.map((audit) => [audit.action, audit.metadata]), [['APPOINTMENT.STATUS', { from: 'PENDING', to: 'COMPLETED' }]]);
    assert.equal(f.counts.invalidations, 1);
  }
  const early = fixture({ status: 'PENDING', date: minutes(1) });
  assert.deepEqual(await early.admin.updateAppointmentStatus(early.appointment.id, 'COMPLETED'), { success: false, error: text('COMPLETE_BEFORE_START') });
  assert.equal(early.appointment.status, 'PENDING');
});

test('a booking request whose start time has passed can no longer be confirmed', async () => {
  for (const date of [NOW, minutes(-1), minutes(-2 * 24 * 60)]) {
    const f = fixture({ status: 'PENDING', date });
    assert.deepEqual(await f.admin.updateAppointmentStatus(f.appointment.id, 'CONFIRMED'), { success: false, error: text('REQUEST_EXPIRED') });
    assert.equal(f.appointment.status, 'PENDING');
    assert.equal(f.counts.slotChecks, 0, 'refused before the slot check, which would name the wrong reason');
    assert.deepEqual(f.enqueued, []);
    assert.deepEqual(f.audits, []);
  }
});

test('a booking request that has not started yet can still be confirmed', async () => {
  const f = fixture({ status: 'PENDING', date: minutes(1) });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.appointment.id, 'CONFIRMED'), { success: true });
  assert.equal(f.appointment.status, 'CONFIRMED');
  assert.deepEqual(f.enqueued, ['CONFIRMATION']);
  assert.equal(f.counts.dispatches, 1);
});

// Tidying the board after the fact (a no-show, a duplicate) must not tell the
// customer their appointment "has been cancelled".
for (const status of ['CONFIRMED', 'COMPLETED']) {
  test(`staff cancelling a ${status} booking that has already started send no email`, async () => {
    for (const date of [NOW, minutes(-90)]) {
      // Most bookings began as an announced online request: that alone never
      // makes tidying them up a "request not confirmed" email.
      const f = fixture({ status, date, announced: true, salonPhone: '07831 830898' });
      assert.deepEqual(await f.admin.updateAppointmentStatus(f.appointment.id, 'CANCELLED'), { success: true });
      assert.equal(f.appointment.status, 'CANCELLED');
      assert.equal(f.appointment.notificationVersion, 1, 'older queued mail for this booking is still invalidated');
      assert.deepEqual(f.enqueued, []);
      assert.equal(f.counts.dispatches, 0, 'nothing was queued, so nothing is dispatched');
      assert.deepEqual(f.audits.map((audit) => audit.action), ['APPOINTMENT.STATUS']);
      assert.equal(f.counts.invalidations, 1);
    }
  });
}

// Declining a request whose time has come does by hand what the lapse step
// (pending-request-lapse.ts) would do, and the customer hears the same thing:
// otherwise they hear nothing at all, since the lapse step only closes
// requests that are still PENDING.
test('declining an announced request once its time has come sends the request-lapsed email, with the salon phone', async () => {
  for (const date of [NOW, minutes(-90), minutes(-72 * 60)]) {
    const f = fixture({ status: 'PENDING', date, announced: true, salonPhone: '07831 830898' });
    assert.deepEqual(await f.admin.updateAppointmentStatus(f.appointment.id, 'CANCELLED'), { success: true });
    assert.equal(f.appointment.status, 'CANCELLED');
    assert.deepEqual(f.queued, [{ kind: 'REQUEST_LAPSED', version: 1, options: { salonPhone: '07831 830898' } }], 'queued at the bumped version');
    assert.equal(f.counts.dispatches, 1, 'the queued email is dispatched after the response');
    assert.deepEqual(f.audits.map((audit) => audit.action), ['APPOINTMENT.STATUS']);
    assert.equal(f.counts.invalidations, 1);
  }
});

test('declining a request whose time passed more than 72 hours ago sends nothing, like the lapse step', async () => {
  const f = fixture({ status: 'PENDING', date: minutes(-72 * 60 - 1), announced: true, salonPhone: '07831 830898' });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.appointment.id, 'CANCELLED'), { success: true });
  assert.equal(f.appointment.status, 'CANCELLED');
  assert.deepEqual(f.enqueued, []);
  assert.equal(f.counts.dispatches, 0);
  assert.equal(f.counts.settingsReads, 0, 'no email, so no phone to look up');
});

test('declining a staff pencil-in once its time has come sends nothing: the customer was never told it awaited confirmation', async () => {
  for (const date of [NOW, minutes(-30)]) {
    const f = fixture({ status: 'PENDING', date, salonPhone: '07831 830898' });
    assert.deepEqual(await f.admin.updateAppointmentStatus(f.appointment.id, 'CANCELLED'), { success: true });
    assert.equal(f.appointment.status, 'CANCELLED');
    assert.equal(f.appointment.notificationVersion, 1);
    assert.deepEqual(f.enqueued, []);
    assert.equal(f.counts.dispatches, 0);
    assert.equal(f.counts.settingsReads, 0);
  }
});

test('a failed salon-phone read still declines the request and sends the email, without the phone', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = fixture({ status: 'PENDING', date: minutes(-30), announced: true, salonPhone: '07831 830898', settingsReadFails: true });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.appointment.id, 'CANCELLED'), { success: true });
  assert.equal(f.appointment.status, 'CANCELLED');
  assert.deepEqual(f.enqueued, ['REQUEST_LAPSED']);
  assert.equal(f.queued[0].options.salonPhone, undefined);
  assert.equal(f.counts.dispatches, 1);
});

test('staff cancelling a booking that is still ahead emails the customer, however soon it is', async () => {
  for (const date of [minutes(1), minutes(13 * 24 * 60)]) {
    const f = fixture({ date });
    assert.deepEqual(await f.admin.updateAppointmentStatus(f.appointment.id, 'CANCELLED'), { success: true });
    assert.deepEqual(f.enqueued, ['CANCELLATION']);
    assert.equal(f.counts.dispatches, 1);
  }
});

test('only admins can change an appointment status', async () => {
  const f = fixture({ role: 'USER', date: minutes(-30) });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.appointment.id, 'COMPLETED'), { success: false, error: text('NOT_AUTHORISED') });
  assert.equal(f.appointment.status, 'CONFIRMED');
  assert.equal(f.counts.writes, 0);
});
