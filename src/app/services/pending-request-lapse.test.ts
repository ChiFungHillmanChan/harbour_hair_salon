import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

const now = new Date('2099-09-01T12:00:00Z');
const minutes = (count: number) => new Date(now.getTime() + count * 60_000);

type Row = {
  id: string; status: string; date: Date; notificationVersion: number; treatwellBookingId: string | null;
  treatwellSyncStatus: string; rescheduleRequestedDate: Date | null; rescheduleRequestedAt: Date | null;
  [key: string]: unknown;
};
type Hooks = {
  onBeforeTransaction?: (rows: Row[]) => void;
  onFindUnique?: (rows: Row[]) => void;
  failEnqueueFor?: string;
  salonPhone?: string;
  settingsReadFails?: boolean;
  invalidationFails?: boolean;
};

function fixture(rows: { id: string; status?: string; date: Date; announced?: boolean; email?: string; treatwellBookingId?: string }[], hooks: Hooks = {}) {
  const appointments: Row[] = rows.map((row) => ({
    id: row.id, status: row.status ?? 'PENDING', date: row.date, notificationVersion: 0,
    treatwellBookingId: row.treatwellBookingId ?? null, treatwellSyncStatus: 'NOT_REQUIRED', treatwellSyncError: null,
    rescheduleRequestedDate: null, rescheduleRequestedAt: null, priceAtBooking: null, durationAtBooking: 60, notes: null,
    user: { email: row.email ?? `${row.id}@example.test`, name: 'Amy', phone: null },
    stylist: { name: 'Ivan', treatwellExternalId: null }, service: { id: 'svc', name: 'Cut', price: 40, duration: 60, treatwellExternalId: null },
  }));
  // The REQUEST_RECEIVED notice an online request queued when it was made.
  const deliveries = rows.filter((row) => row.announced).map((row) => ({ id: `n-${row.id}`, appointmentId: row.id, kind: 'REQUEST_RECEIVED' }));
  const enqueued: { id: string; kind: string; version: number; salonPhone?: string }[] = [];
  const audits: { action: string; targetId: string; metadata: Record<string, unknown> }[] = [];
  const counts = { settingsReads: 0, transactions: 0, invalidations: 0 };
  const tx = {
    siteSettings: { findUnique: async () => {
      counts.settingsReads++;
      if (hooks.settingsReadFails) throw new Error('settings read failed');
      return hooks.salonPhone ? { phone: hooks.salonPhone } : null;
    } },
    appointment: {
      findMany: async ({ where, take }: { where: { status: string; date: { lte: Date } }; take: number }) => appointments
        .filter((row) => row.status === where.status && row.date <= where.date.lte)
        .slice(0, take).map((row) => ({ id: row.id })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const found = structuredClone(appointments.find((row) => row.id === where.id) ?? null);
        hooks.onFindUnique?.(appointments); // mutates AFTER the clone: the write then races
        return found;
      },
      updateMany: async ({ where, data }: { where: { id: string; status: string; date: Date }; data: Record<string, unknown> }) => {
        const row = appointments.find((item) => item.id === where.id);
        if (!row || row.status !== where.status || row.date.getTime() !== where.date.getTime()) return { count: 0 };
        for (const [key, value] of Object.entries(data)) {
          row[key] = value && typeof value === 'object' && 'increment' in value ? Number(row[key]) + Number(value.increment) : value;
        }
        return { count: 1 };
      },
    },
    notificationDelivery: {
      findFirst: async ({ where }: { where: { appointmentId: string; kind: string } }) =>
        deliveries.find((row) => row.appointmentId === where.appointmentId && row.kind === where.kind) ?? null,
    },
    auditEvent: { create: async ({ data }: { data: { action: string; targetId: string; metadataJson: string } }) => {
      audits.push({ action: data.action, targetId: data.targetId, metadata: JSON.parse(data.metadataJson) });
      return { id: 'a' };
    } },
  };
  const service = loadServerModule<typeof import('./pending-request-lapse')>('src/app/services/pending-request-lapse.ts', {
    '@/app/lib/prisma': tx,
    './booking-service': { runSerializableWithRetry: async (fn: (client: unknown) => unknown) => {
      counts.transactions++;
      hooks.onBeforeTransaction?.(appointments);
      // Mirror a real transaction: if fn throws, undo its writes.
      const snapshot = structuredClone(appointments);
      const auditCount = audits.length;
      const enqueuedCount = enqueued.length;
      try { return await fn(tx); } catch (error) {
        appointments.splice(0, appointments.length, ...snapshot);
        audits.length = auditCount;
        enqueued.length = enqueuedCount;
        throw error;
      }
    } },
    './notification-outbox-service': {
      enqueueAppointmentNotification: async (_db: unknown, kind: string, appointment: Row & { user: { email: string } }, options: { salonPhone?: string }) => {
        if (hooks.failEnqueueFor === appointment.id) throw new Error('enqueue failed');
        // The real outbox writes nothing for an undeliverable placeholder address.
        if (appointment.user.email.endsWith('.invalid')) return null;
        enqueued.push({ id: appointment.id, kind, version: appointment.notificationVersion, ...(options.salonPhone ? { salonPhone: options.salonPhone } : {}) });
        return { id: 'e' };
      },
    },
    './stylist-ical-cache': { invalidateStylistIcalFeedFromCron: () => {
      counts.invalidations++;
      if (hooks.invalidationFails) throw new Error('no cache in this context');
    } },
  });
  return { service, appointments, enqueued, audits, counts };
}

test('a request whose start time has come is cancelled once, with one lapse email and one audit', async () => {
  const f = fixture([
    { id: 'started', date: minutes(-1), announced: true },
    { id: 'at-start', date: now, announced: true },
    { id: 'ahead', date: minutes(1), announced: true },
    { id: 'confirmed', status: 'CONFIRMED', date: minutes(-60) },
    { id: 'cancelled', status: 'CANCELLED', date: minutes(-60) },
  ]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 2, failed: 0 });
  assert.deepEqual(f.appointments.map((row) => [row.id, row.status]), [
    ['started', 'CANCELLED'], ['at-start', 'CANCELLED'], ['ahead', 'PENDING'], ['confirmed', 'CONFIRMED'], ['cancelled', 'CANCELLED'],
  ]);
  assert.deepEqual(f.appointments.slice(0, 2).map((row) => row.notificationVersion), [1, 1], 'earlier queued request mail is retired');
  assert.deepEqual(f.enqueued.map((event) => [event.id, event.kind, event.version]), [['started', 'REQUEST_LAPSED', 1], ['at-start', 'REQUEST_LAPSED', 1]]);
  assert.deepEqual(f.audits.map((audit) => [audit.action, audit.targetId]), [['APPOINTMENT.LAPSED', 'started'], ['APPOINTMENT.LAPSED', 'at-start']]);
  assert.deepEqual(f.audits[0].metadata, { from: 'PENDING', to: 'CANCELLED', start: minutes(-1).toISOString(), notified: true });
  assert.equal(f.counts.transactions, 2, 'each lapse runs in its own serializable transaction');
  assert.equal(f.counts.invalidations, 1, 'the busy feed is dropped once per run that changed something');

  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 0, failed: 0 }, 're-running is a no-op');
  assert.equal(f.enqueued.length, 2);
  assert.equal(f.counts.invalidations, 1);
});

// Staff "pencil in" bookings are PENDING too, but nobody told the customer they
// were awaiting confirmation (no REQUEST_RECEIVED), so there is nobody to tell
// that it lapsed — often the customer simply came in.
test('a pencilled-in booking the customer was never told about is closed without an email', async () => {
  const f = fixture([{ id: 'pencil', date: minutes(-30) }]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
  assert.equal(f.appointments[0].status, 'CANCELLED');
  assert.deepEqual(f.enqueued, []);
  assert.equal(f.audits[0].metadata.notified, false);
});

test('an undeliverable address is closed without an email and recorded as not notified', async () => {
  const f = fixture([{ id: 'walk-in', date: minutes(-30), announced: true, email: 'x@walk-in.harbourhair.invalid' }]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
  assert.deepEqual(f.enqueued, []);
  assert.equal(f.audits[0].metadata.notified, false);
});

test('a request confirmed or moved after the candidate read is left alone', async () => {
  const confirmed = fixture([{ id: 'r', date: minutes(-5), announced: true }], { onBeforeTransaction: (rows) => { rows[0].status = 'CONFIRMED'; } });
  assert.deepEqual(await confirmed.service.lapseStartedPendingRequests(now), { lapsed: 0, failed: 0 });
  assert.equal(confirmed.appointments[0].status, 'CONFIRMED');
  const moved = fixture([{ id: 'r', date: minutes(-5), announced: true }], { onBeforeTransaction: (rows) => { rows[0].date = minutes(24 * 60); } });
  assert.deepEqual(await moved.service.lapseStartedPendingRequests(now), { lapsed: 0, failed: 0 });
  assert.equal(moved.appointments[0].status, 'PENDING');
  assert.deepEqual([...confirmed.enqueued, ...moved.enqueued, ...confirmed.audits, ...moved.audits], []);
  assert.equal(confirmed.counts.invalidations + moved.counts.invalidations, 0);
});

test('when the conditional write loses the race nothing is emailed or audited', async () => {
  const f = fixture([{ id: 'race', date: minutes(-5), announced: true }], { onFindUnique: (rows) => { rows[0].date = minutes(60); } });
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 0, failed: 0 });
  assert.equal(f.appointments[0].status, 'PENDING');
  assert.deepEqual(f.enqueued, []);
  assert.deepEqual(f.audits, []);
});

test('a row that throws is rolled back and skipped without stopping the rest', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = fixture([{ id: 'poison', date: minutes(-20), announced: true }, { id: 'fine', date: minutes(-10), announced: true }], { failEnqueueFor: 'poison' });
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 1 });
  assert.equal(f.appointments[0].status, 'PENDING', 'the failed row stays due and is retried next run');
  assert.equal(f.appointments[1].status, 'CANCELLED');
  assert.deepEqual(f.enqueued.map((event) => event.id), ['fine']);
});

test('a run with nothing due reads no settings and drops no cache', async () => {
  const f = fixture([{ id: 'ahead', date: minutes(30), announced: true }], { salonPhone: '07831 830898' });
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 0, failed: 0 });
  assert.deepEqual(f.counts, { settingsReads: 0, transactions: 0, invalidations: 0 });
});

test('lapse emails carry the salon phone, read once per run; a failed read still lapses everything', async (t) => {
  const f = fixture([{ id: 'one', date: minutes(-20), announced: true }, { id: 'two', date: minutes(-10), announced: true }], { salonPhone: '07831 830898' });
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 2, failed: 0 });
  assert.deepEqual(f.enqueued.map((event) => event.salonPhone), ['07831 830898', '07831 830898']);
  assert.equal(f.counts.settingsReads, 1);

  t.mock.method(console, 'error', () => {});
  const failing = fixture([{ id: 'one', date: minutes(-20), announced: true }], { salonPhone: '07831 830898', settingsReadFails: true });
  assert.deepEqual(await failing.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
  assert.equal(failing.enqueued[0].salonPhone, undefined);
});

test('a failing feed invalidation never fails the run (the cache heals within a day)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = fixture([{ id: 'r', date: minutes(-5), announced: true }], { invalidationFails: true });
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
});

test('a request already sent to Treatwell is queued for cancellation there, like a staff cancellation', async () => {
  const f = fixture([{ id: 'synced', date: minutes(-5), treatwellBookingId: 'tw-1' }, { id: 'local', date: minutes(-5) }]);
  await f.service.lapseStartedPendingRequests(now);
  assert.deepEqual(f.appointments.map((row) => row.treatwellSyncStatus), ['PENDING', 'NOT_REQUIRED']);
});
