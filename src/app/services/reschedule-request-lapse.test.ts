import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

const now = new Date('2099-09-01T12:00:00Z');

type Hooks = {
  onBeforeTransaction?: (transactionNumber: number, rows: Row[]) => void;
  onFindUnique?: (id: string, rows: Row[]) => void;
  failEnqueueFor?: string;
};
/** Due: requested time under 24 h away, OR the booking's original time has passed with a request still open. */
type DueWhere = { status: string; OR: ({ rescheduleRequestedDate: { lt: Date } } | { date: { lt: Date }; rescheduleRequestedDate: { not: null } })[] };
type Row = { id: string; rescheduleRequestedDate: Date | null; rescheduleRequestedAt: Date | null; [key: string]: unknown };

function fixture(rows: { id: string; requestedDate: Date | null; requestedAt: Date | null; status?: string; date?: Date }[], hooks: Hooks = {}) {
  const appointments = rows.map((row) => ({
    id: row.id, status: row.status ?? 'CONFIRMED', date: row.date ?? new Date('2099-09-14T12:00:00Z'), notificationVersion: 0,
    rescheduleRequestedDate: row.requestedDate, rescheduleRequestedAt: row.requestedAt,
    priceAtBooking: null, durationAtBooking: 60, notes: null,
    user: { email: `${row.id}@example.test`, name: 'Amy', phone: null }, stylist: { name: 'Ivan' }, service: { name: 'Cut', duration: 60 },
  }));
  const enqueued: { id: string; kind: string; requestedAt: string }[] = [];
  const audits: string[] = [];
  const tx = {
    appointment: {
      findMany: async ({ where }: { where: DueWhere }) => appointments.filter((row) => row.status === where.status && where.OR.some((part) =>
        'date' in part
          ? row.date < part.date.lt && row.rescheduleRequestedDate !== null
          : row.rescheduleRequestedDate !== null && row.rescheduleRequestedDate < part.rescheduleRequestedDate.lt)).map((row) => ({ id: row.id })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const found = structuredClone(appointments.find((row) => row.id === where.id) ?? null);
        hooks.onFindUnique?.(where.id, appointments as unknown as Row[]); // mutates AFTER the clone: the write then races
        return found;
      },
      updateMany: async ({ where, data }: { where: { id: string; rescheduleRequestedAt: Date }; data: Record<string, unknown> }) => {
        const row = appointments.find((item) => item.id === where.id);
        if (!row || row.rescheduleRequestedAt?.getTime() !== where.rescheduleRequestedAt.getTime()) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
    },
    auditEvent: { create: async ({ data }: { data: { action: string } }) => { audits.push(data.action); return { id: 'a' }; } },
  };
  let transactions = 0;
  const service = loadServerModule<typeof import('./reschedule-request-lapse')>('src/app/services/reschedule-request-lapse.ts', {
    '@/app/lib/prisma': tx,
    './booking-service': { runSerializableWithRetry: async (fn: (client: unknown) => unknown) => {
      transactions++;
      hooks.onBeforeTransaction?.(transactions, appointments as unknown as Row[]);
      // Mirror a real transaction: if fn throws, undo its writes.
      const snapshot = structuredClone(appointments);
      const auditCount = audits.length;
      try { return await fn(tx); } catch (error) {
        appointments.splice(0, appointments.length, ...snapshot); audits.length = auditCount; throw error;
      }
    } },
    './notification-outbox-service': {
      enqueueAppointmentNotification: async (_db: unknown, kind: string, appointment: { id: string }, options: { requestedAt: Date }) => {
        if (hooks.failEnqueueFor === appointment.id) throw new Error('enqueue failed');
        enqueued.push({ id: appointment.id, kind, requestedAt: options.requestedAt.toISOString() }); return { id: 'e' };
      },
    },
  });
  return { service, appointments, enqueued, audits, transactions: () => transactions };
}

test('only requests whose time is under 24 hours away lapse, once, with one email each', async () => {
  const f = fixture([
    { id: 'soon', requestedDate: new Date('2099-09-02T11:00:00Z'), requestedAt: new Date('2099-08-30T10:00:00Z') },
    { id: 'later', requestedDate: new Date('2099-09-10T09:00:00Z'), requestedAt: new Date('2099-08-31T10:00:00Z') },
    { id: 'none', requestedDate: null, requestedAt: null },
  ]);
  assert.deepEqual(await f.service.lapseExpiredRescheduleRequests(now), { lapsed: 1, failed: 0 });
  assert.deepEqual(f.enqueued, [{ id: 'soon', kind: 'RESCHEDULE_LAPSED', requestedAt: '2099-08-30T10:00:00.000Z' }]);
  assert.deepEqual(f.audits, ['APPOINTMENT.RESCHEDULE_LAPSED']);
  assert.equal(f.appointments[0].rescheduleRequestedAt, null);
  assert.ok(f.appointments[1].rescheduleRequestedAt);
  assert.equal(f.transactions(), 1, 'each lapse runs in its own serializable transaction');
  assert.deepEqual(await f.service.lapseExpiredRescheduleRequests(now), { lapsed: 0, failed: 0 }, 're-running is a no-op');
  assert.equal(f.enqueued.length, 1);
});

test('cancelled bookings are never lapsed', async () => {
  const f = fixture([{ id: 'gone', status: 'CANCELLED', requestedDate: new Date('2099-09-02T11:00:00Z'), requestedAt: new Date('2099-08-30T10:00:00Z') }]);
  assert.deepEqual(await f.service.lapseExpiredRescheduleRequests(now), { lapsed: 0, failed: 0 });
  assert.equal(f.enqueued.length, 0);
});

const due = (id: string, hour: number) => ({ id, requestedDate: new Date(`2099-09-02T${String(hour).padStart(2, '0')}:00:00Z`), requestedAt: new Date('2099-08-30T10:00:00Z') });

test('a request replaced with a later one after the candidate read is left alone', async () => {
  const f = fixture([due('swap', 11)], {
    onBeforeTransaction: (_n, rows) => {
      rows[0].rescheduleRequestedDate = new Date('2099-09-10T09:00:00Z');
      rows[0].rescheduleRequestedAt = new Date('2099-09-01T11:59:00Z');
    },
  });
  assert.deepEqual(await f.service.lapseExpiredRescheduleRequests(now), { lapsed: 0, failed: 0 });
  assert.equal(f.enqueued.length, 0);
  assert.ok(f.appointments[0].rescheduleRequestedAt, 'the new request survives');
});

test('when the conditional write loses the race nothing is emailed or audited', async () => {
  const f = fixture([due('race', 11)], {
    onFindUnique: (_id, rows) => { rows[0].rescheduleRequestedAt = new Date('2099-09-01T11:59:00Z'); },
  });
  assert.deepEqual(await f.service.lapseExpiredRescheduleRequests(now), { lapsed: 0, failed: 0 });
  assert.equal(f.enqueued.length, 0);
  assert.deepEqual(f.audits, []);
  assert.ok(f.appointments[0].rescheduleRequestedAt);
});

test('a row that throws is skipped and does not stop the rest', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = fixture([due('poison', 10), due('fine', 11)], { failEnqueueFor: 'poison' });
  assert.deepEqual(await f.service.lapseExpiredRescheduleRequests(now), { lapsed: 1, failed: 1 });
  assert.deepEqual(f.enqueued.map((e) => e.id), ['fine']);
  assert.ok(f.appointments[0].rescheduleRequestedAt, 'the failed row stays due (its transaction rolled back)');
  assert.equal(f.appointments[1].rescheduleRequestedAt, null);
});

// A visit that already happened needs no answer and no email; the request is
// only tidied away (and audited) so it stops showing anywhere.
test('a request on a booking whose original time has passed is cleared and audited without an email', async () => {
  const f = fixture([
    { id: 'gone', date: new Date('2099-09-01T09:00:00Z'), requestedDate: new Date('2099-09-10T09:00:00Z'), requestedAt: new Date('2099-08-30T10:00:00Z') },
    { id: 'soon', requestedDate: new Date('2099-09-02T11:00:00Z'), requestedAt: new Date('2099-08-30T11:00:00Z') },
    { id: 'later', requestedDate: new Date('2099-09-10T09:00:00Z'), requestedAt: new Date('2099-08-31T10:00:00Z') },
  ]);
  assert.deepEqual(await f.service.lapseExpiredRescheduleRequests(now), { lapsed: 2, failed: 0 });
  assert.deepEqual(f.enqueued.map((event) => event.id), ['soon'], 'the booking still ahead is emailed; the past one is not');
  assert.deepEqual(f.audits, ['APPOINTMENT.RESCHEDULE_LAPSED', 'APPOINTMENT.RESCHEDULE_LAPSED']);
  assert.equal(f.appointments[0].rescheduleRequestedAt, null);
  assert.equal(f.appointments[1].rescheduleRequestedAt, null);
  assert.ok(f.appointments[2].rescheduleRequestedAt, 'a future booking with a request over 24 h away is untouched');
  assert.deepEqual(await f.service.lapseExpiredRescheduleRequests(now), { lapsed: 0, failed: 0 }, 're-running is a no-op');
});
