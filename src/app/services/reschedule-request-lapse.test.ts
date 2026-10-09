import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

const now = new Date('2099-09-01T12:00:00Z');

function fixture(rows: { id: string; requestedDate: Date | null; requestedAt: Date | null; status?: string }[]) {
  const appointments = rows.map((row) => ({
    id: row.id, status: row.status ?? 'CONFIRMED', date: new Date('2099-09-14T12:00:00Z'), notificationVersion: 0,
    rescheduleRequestedDate: row.requestedDate, rescheduleRequestedAt: row.requestedAt,
    priceAtBooking: null, durationAtBooking: 60, notes: null,
    user: { email: `${row.id}@example.test`, name: 'Amy', phone: null }, stylist: { name: 'Ivan' }, service: { name: 'Cut', duration: 60 },
  }));
  const enqueued: { id: string; kind: string; requestedAt: string }[] = [];
  const audits: string[] = [];
  const tx = {
    appointment: {
      findMany: async ({ where }: { where: { status: string; rescheduleRequestedDate: { lt: Date } } }) =>
        appointments.filter((row) => row.status === where.status && row.rescheduleRequestedDate && row.rescheduleRequestedDate < where.rescheduleRequestedDate.lt).map((row) => ({ id: row.id })),
      findUnique: async ({ where }: { where: { id: string } }) => structuredClone(appointments.find((row) => row.id === where.id) ?? null),
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
    './booking-service': { runSerializableWithRetry: async (fn: (client: unknown) => unknown) => { transactions++; return fn(tx); } },
    './notification-outbox-service': {
      enqueueAppointmentNotification: async (_db: unknown, kind: string, appointment: { id: string }, options: { requestedAt: Date }) => {
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
  assert.equal(await f.service.lapseExpiredRescheduleRequests(now), 1);
  assert.deepEqual(f.enqueued, [{ id: 'soon', kind: 'RESCHEDULE_LAPSED', requestedAt: '2099-08-30T10:00:00.000Z' }]);
  assert.deepEqual(f.audits, ['APPOINTMENT.RESCHEDULE_LAPSED']);
  assert.equal(f.appointments[0].rescheduleRequestedAt, null);
  assert.ok(f.appointments[1].rescheduleRequestedAt);
  assert.equal(f.transactions(), 1, 'each lapse runs in its own serializable transaction');
  assert.equal(await f.service.lapseExpiredRescheduleRequests(now), 0, 're-running is a no-op');
  assert.equal(f.enqueued.length, 1);
});

test('cancelled bookings are never lapsed', async () => {
  const f = fixture([{ id: 'gone', status: 'CANCELLED', requestedDate: new Date('2099-09-02T11:00:00Z'), requestedAt: new Date('2099-08-30T10:00:00Z') }]);
  assert.equal(await f.service.lapseExpiredRescheduleRequests(now), 0);
  assert.equal(f.enqueued.length, 0);
});
