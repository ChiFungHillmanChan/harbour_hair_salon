import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

const now = new Date('2099-09-01T12:00:00Z');
const minutes = (count: number) => new Date(now.getTime() + count * 60_000);
/** When the owner switched the rule on (SiteSettings.lateAutoCancelSince). */
const SINCE = new Date('2099-08-01T00:00:00Z');

/** A card deposit as the fixture stores it (PaymentAttempt), tied to one booking. */
type AttemptRow = {
  id: string; appointmentId: string; status: string; amountPence: number; squarePaymentId: string | null; delayedUntil: Date | null;
  environment: string; locationId: string; updatedAt: Date; lastError: string | null; voidedAt: Date | null;
};
type Row = {
  id: string; status: string; date: Date; arrivedAt: Date | null; lateCancelledAt: Date | null; notificationVersion: number;
  [key: string]: unknown;
};
type Hooks = {
  /** The settings row the step reads (default: switched on at SINCE). */
  settings?: { lateAutoCancelSince: Date | null } | null;
  onBeforeTransaction?: (rows: Row[], attempts: AttemptRow[]) => void;
  onFindUnique?: (rows: Row[]) => void;
  failEnqueueFor?: string;
};
type FixtureRow = {
  id: string; status?: string; date: Date; arrivedAt?: Date;
  /** The booking's card deposit. */
  deposit?: { status: string; amountPence?: number };
};

const SANDBOX = { environment: 'sandbox', accessToken: 'sandbox-token', applicationId: 'sandbox-sq0idb-fixture', locationId: 'fixture-location', webhookSignatureKey: 'key', webhookNotificationUrl: 'https://example.test/api/webhooks/square' };

/** A Prisma-style filter: equality (null and Dates included), `in`, `gt`, `gte`, `lte`. */
function matches(record: Record<string, unknown> | undefined, filter: Record<string, unknown>): boolean {
  if (!record) return false;
  return Object.entries(filter).every(([key, condition]) => {
    const value = record[key];
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (condition && typeof condition === 'object') {
      const { in: list, gt, gte, lte } = condition as { in?: unknown[]; gt?: Date; gte?: Date; lte?: Date };
      if (list) return list.includes(value);
      if (!(value instanceof Date)) return false;
      return (!gt || value > gt) && (!gte || value >= gte) && (!lte || value <= lte);
    }
    return value === condition;
  });
}

function fixture(rows: FixtureRow[], hooks: Hooks = {}) {
  const appointments: Row[] = rows.map((row) => ({
    id: row.id, status: row.status ?? 'CONFIRMED', date: row.date, arrivedAt: row.arrivedAt ?? null, lateCancelledAt: null,
    notificationVersion: 0, treatwellBookingId: null, treatwellSyncStatus: 'NOT_REQUIRED', treatwellSyncError: null,
    rescheduleRequestedDate: null, rescheduleRequestedAt: null, priceAtBooking: null, durationAtBooking: 60, notes: null,
    user: { email: `${row.id}@example.test`, name: 'Amy', phone: null },
    stylist: { name: 'Ivan', treatwellExternalId: null }, service: { id: 'svc', name: 'Cut', price: 40, duration: 60, treatwellExternalId: null },
  }));
  const attempts: AttemptRow[] = rows.filter((row) => row.deposit).map((row) => ({
    id: `attempt-${row.id}`, appointmentId: row.id, status: row.deposit!.status, amountPence: row.deposit!.amountPence ?? 1500,
    squarePaymentId: `payment-${row.id}`, delayedUntil: minutes(3 * 24 * 60), environment: 'sandbox', locationId: 'fixture-location',
    updatedAt: minutes(-24 * 60), lastError: null, voidedAt: null,
  }));
  /** Refunds (PaymentRefund): a kept deposit must never create one. */
  const refunds: { id: string; attemptId: string; amountPence: number; status: string }[] = [];
  const attemptFor = (appointmentId: string) => attempts.find((attempt) => attempt.appointmentId === appointmentId);
  const withDeposit = (row: Row) => ({ ...structuredClone(row), paymentAttempt: structuredClone(attemptFor(row.id) ?? null) });
  const enqueued: { id: string; kind: string; version: number; depositOutcome?: string; deposit?: unknown; notBefore?: Date }[] = [];
  const audits: { actorUserId: string | null; action: string; targetId: string; metadata: Record<string, unknown> }[] = [];
  const counts = { settingsReads: 0, appointmentQueries: 0, transactions: 0, invalidations: 0 };
  const square: string[] = [];
  const tx = {
    siteSettings: { findUnique: async ({ select }: { select: Record<string, boolean> }) => {
      counts.settingsReads++;
      if (select.lateAutoCancelSince) return hooks.settings === undefined ? { lateAutoCancelSince: SINCE } : hooks.settings;
      return null; // no salon phone on file
    } },
    appointment: {
      findMany: async ({ where, take }: { where: Record<string, unknown>; take: number }) => {
        counts.appointmentQueries++;
        return appointments.filter((row) => matches(row, where)).slice(0, take).map((row) => ({ id: row.id }));
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        counts.appointmentQueries++;
        const row = appointments.find((item) => item.id === where.id);
        const found = row ? withDeposit(row) : null;
        hooks.onFindUnique?.(appointments); // mutates AFTER the clone: the write then races
        return found;
      },
      // Honours every filter of the conditional write (id, status, arrivedAt: null, date).
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        counts.appointmentQueries++;
        const matched = appointments.filter((row) => matches(row, where));
        for (const row of matched) {
          for (const [key, value] of Object.entries(data)) {
            row[key] = value && typeof value === 'object' && 'increment' in value ? Number(row[key]) + Number(value.increment) : value;
          }
        }
        return { count: matched.length };
      },
    },
    paymentAttempt: {
      findUnique: async ({ where }: { where: { id?: string; appointmentId?: string } }) =>
        structuredClone(attempts.find((attempt) => (where.id ? attempt.id === where.id : attempt.appointmentId === where.appointmentId)) ?? null),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<AttemptRow> }) => {
        const matched = attempts.filter((attempt) => matches(attempt, where));
        // @updatedAt, as Prisma sets it.
        for (const attempt of matched) Object.assign(attempt, { updatedAt: now }, data);
        return { count: matched.length };
      },
    },
    paymentRefund: {
      findMany: async ({ where }: { where: { attemptId: string; status: { in: string[] } } }) =>
        refunds.filter((row) => row.attemptId === where.attemptId && where.status.in.includes(row.status)).map((row) => ({ amountPence: row.amountPence })),
      create: async ({ data }: { data: { attemptId: string; amountPence: number; status: string } }) => {
        const row = { id: `refund-${refunds.length + 1}`, ...data };
        refunds.push(row);
        return { id: row.id, amountPence: row.amountPence, idempotencyKey: 'key' };
      },
    },
    auditEvent: { create: async ({ data }: { data: { actorUserId: string | null; action: string; targetId: string; metadataJson: string } }) => {
      audits.push({ actorUserId: data.actorUserId, action: data.action, targetId: data.targetId, metadata: JSON.parse(data.metadataJson) });
      return { id: 'a' };
    } },
  };
  // Square is never asked anything: a kept deposit moves no money.
  const gateway = {
    cancel: async () => { square.push('cancel'); throw new Error('unexpected Square call'); },
    getPayment: async () => { square.push('getPayment'); throw new Error('unexpected Square call'); },
    refund: async () => { square.push('refund'); throw new Error('unexpected Square call'); },
  };
  const deposits = loadServerModule<typeof import('./deposit-lifecycle')>('src/app/services/deposit-lifecycle.ts', {
    '@/app/lib/online-booking-lock': { usableSquareConfig: () => SANDBOX },
    './square-gateway': { createSquareGateway: () => gateway },
  });
  const service = loadServerModule<typeof import('./late-arrival-cancel')>('src/app/services/late-arrival-cancel.ts', {
    '@/app/lib/prisma': tx,
    './deposit-lifecycle': deposits,
    './booking-service': { runSerializableWithRetry: async (fn: (client: unknown) => unknown) => {
      counts.transactions++;
      hooks.onBeforeTransaction?.(appointments, attempts);
      // Mirror a real transaction: if fn throws, undo its writes.
      const snapshot = structuredClone(appointments);
      const attemptSnapshot = structuredClone(attempts);
      const refundSnapshot = structuredClone(refunds);
      const auditCount = audits.length;
      const enqueuedCount = enqueued.length;
      try { return await fn(tx); } catch (error) {
        appointments.splice(0, appointments.length, ...snapshot);
        attempts.splice(0, attempts.length, ...attemptSnapshot);
        refunds.splice(0, refunds.length, ...refundSnapshot);
        audits.length = auditCount;
        enqueued.length = enqueuedCount;
        throw error;
      }
    } },
    './notification-outbox-service': {
      enqueueAppointmentNotification: async (
        _db: unknown, kind: string, appointment: Row & { paymentAttempt?: unknown },
        options: { depositOutcome?: string; notBefore?: Date },
      ) => {
        if (hooks.failEnqueueFor === appointment.id) throw new Error('enqueue failed');
        enqueued.push({
          id: appointment.id, kind, version: appointment.notificationVersion,
          ...(options.depositOutcome ? { depositOutcome: options.depositOutcome, deposit: appointment.paymentAttempt } : {}),
          ...(options.notBefore ? { notBefore: options.notBefore } : {}),
        });
        return { id: 'e' };
      },
    },
    './stylist-ical-cache': { invalidateStylistIcalFeedFromCron: () => { counts.invalidations++; } },
  });
  return { service, appointments, attempts, refunds, enqueued, audits, counts, square };
}

const NOTHING_DONE = { enabled: true, cancelled: 0, skipped: 0, failed: 0 };

test('switched off: reads only the settings row and cancels nothing', async () => {
  for (const settings of [null, { lateAutoCancelSince: null }]) {
    const f = fixture([{ id: 'late', date: minutes(-20), deposit: { status: 'CAPTURED' } }], { settings });
    assert.deepEqual(await f.service.cancelLateArrivals(now), { enabled: false, cancelled: 0, skipped: 0, failed: 0 });
    assert.deepEqual(f.counts, { settingsReads: 1, appointmentQueries: 0, transactions: 0, invalidations: 0 }, JSON.stringify(settings));
    assert.deepEqual([f.appointments[0].status, f.attempts[0].status, f.enqueued, f.audits], ['CONFIRMED', 'CAPTURED', [], []]);
  }
});

test('cancels a CONFIRMED booking 15+ min late: KEPT deposit, delayed email, audit, feed', async () => {
  const f = fixture([{ id: 'late', date: minutes(-20), deposit: { status: 'CAPTURED', amountPence: 1500 } }]);
  assert.deepEqual(await f.service.cancelLateArrivals(now), { enabled: true, cancelled: 1, skipped: 0, failed: 0 });
  const [row] = f.appointments;
  assert.equal(row.status, 'CANCELLED');
  assert.deepEqual(row.lateCancelledAt, now);
  assert.equal(row.arrivedAt, null);
  assert.equal(row.notificationVersion, 1, 'earlier queued booking mail is retired');
  assert.equal(f.attempts[0].status, 'KEPT', 'kept as for a no-show');
  assert.deepEqual([f.refunds, f.square], [[], []], 'nothing refunded, Square never asked');
  assert.deepEqual(f.enqueued, [{
    id: 'late', kind: 'LATE_CANCELLED', version: 1, depositOutcome: 'KEPT', deposit: { status: 'CAPTURED', amountPence: 1500 },
    notBefore: minutes(30),
  }]);
  assert.deepEqual(f.audits, [{
    actorUserId: null, action: 'APPOINTMENT.LATE_AUTO_CANCELLED', targetId: 'late',
    metadata: { from: 'CONFIRMED', to: 'CANCELLED', start: minutes(-20).toISOString(), minutesLate: 20, notified: true, deposit: 'KEPT', depositPence: 1500 },
  }]);
  assert.equal(f.counts.transactions, 1, 'each booking closes in its own serializable transaction');
  assert.equal(f.counts.invalidations, 1, 'the chair leaves the busy feed');

  assert.deepEqual(await f.service.cancelLateArrivals(now), NOTHING_DONE, 're-running is a no-op');
  assert.deepEqual([f.enqueued.length, f.audits.length, f.counts.invalidations], [1, 1, 1]);
});

test('14 minutes late, arrived, PENDING, COMPLETED, older than 120 min: untouched', async () => {
  const f = fixture([
    { id: 'fourteen', date: minutes(-14) },
    { id: 'arrived', date: minutes(-20), arrivedAt: minutes(-25) },
    { id: 'pending', status: 'PENDING', date: minutes(-20) },
    { id: 'completed', status: 'COMPLETED', date: minutes(-20), arrivedAt: minutes(-20) },
    { id: 'too-old', date: minutes(-121) },
    // The boundaries themselves are in: exactly 15 minutes late, exactly 120 minutes back.
    { id: 'fifteen', date: minutes(-15) },
    { id: 'lookback-edge', date: minutes(-120) },
  ]);
  assert.deepEqual(await f.service.cancelLateArrivals(now), { enabled: true, cancelled: 2, skipped: 0, failed: 0 });
  assert.deepEqual(f.appointments.map((row) => [row.id, row.status, row.lateCancelledAt]), [
    ['fourteen', 'CONFIRMED', null], ['arrived', 'CONFIRMED', null], ['pending', 'PENDING', null], ['completed', 'COMPLETED', null],
    ['too-old', 'CONFIRMED', null], ['fifteen', 'CANCELLED', now], ['lookback-edge', 'CANCELLED', now],
  ]);
  assert.deepEqual(f.enqueued.map((event) => event.id), ['fifteen', 'lookback-edge']);
  assert.equal(f.counts.transactions, 2, 'only the candidates open a transaction');
});

test('bookings that start before the switch-on are never touched', async () => {
  const f = fixture([{ id: 'before', date: minutes(-20) }], { settings: { lateAutoCancelSince: minutes(-10) } });
  assert.deepEqual(await f.service.cancelLateArrivals(now), NOTHING_DONE);
  assert.deepEqual([f.appointments[0].status, f.enqueued, f.audits, f.counts.transactions, f.counts.invalidations], ['CONFIRMED', [], [], 0, 0]);

  // The switch-on instant itself is out; anything starting after it is in.
  const edge = fixture([{ id: 'at-switch-on', date: minutes(-20) }, { id: 'after', date: minutes(-19) }], { settings: { lateAutoCancelSince: minutes(-20) } });
  assert.deepEqual(await edge.service.cancelLateArrivals(now), { enabled: true, cancelled: 1, skipped: 0, failed: 0 });
  assert.deepEqual(edge.appointments.map((row) => [row.id, row.status]), [['at-switch-on', 'CONFIRMED'], ['after', 'CANCELLED']]);
});

test('a concurrent arrival wins', async () => {
  // Staff tap "Arrived" after the candidate read, before the transaction re-reads the booking…
  const before = fixture([{ id: 'late', date: minutes(-20), deposit: { status: 'CAPTURED' } }], {
    onBeforeTransaction: (rows) => { rows[0].arrivedAt = minutes(-1); },
  });
  // …or between that re-read and the conditional write, which then matches nothing.
  const during = fixture([{ id: 'late', date: minutes(-20), deposit: { status: 'CAPTURED' } }], {
    onFindUnique: (rows) => { rows[0].arrivedAt = minutes(-1); },
  });
  for (const f of [before, during]) {
    assert.deepEqual(await f.service.cancelLateArrivals(now), { enabled: true, cancelled: 0, skipped: 1, failed: 0 });
    assert.deepEqual([f.appointments[0].status, f.appointments[0].lateCancelledAt, f.appointments[0].notificationVersion], ['CONFIRMED', null, 0]);
    assert.equal(f.attempts[0].status, 'CAPTURED', 'the deposit stays taken towards the visit');
    assert.deepEqual([f.enqueued, f.audits, f.square], [[], [], []]);
    assert.equal(f.counts.invalidations, 0);
  }
});

test('a capture in flight is skipped and retried later', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  for (const status of ['CAPTURING', 'CAPTURE_UNKNOWN']) {
    const f = fixture([{ id: 'late', date: minutes(-20), deposit: { status } }]);
    assert.deepEqual(await f.service.cancelLateArrivals(now), { enabled: true, cancelled: 0, skipped: 1, failed: 0 }, status);
    const [row] = f.appointments;
    assert.deepEqual([row.status, row.lateCancelledAt, row.notificationVersion], ['CONFIRMED', null, 0], `${status}: the closing rolled back`);
    assert.equal(f.attempts[0].status, status);
    assert.deepEqual([f.enqueued, f.audits, f.refunds, f.square], [[], [], [], []]);
    assert.equal(f.counts.invalidations, 0);

    // The capture lands; the next run closes the booking and keeps the deposit.
    f.attempts[0].status = 'CAPTURED';
    assert.deepEqual(await f.service.cancelLateArrivals(now), { enabled: true, cancelled: 1, skipped: 0, failed: 0 }, `${status} retried`);
    assert.deepEqual([f.appointments[0].status, f.attempts[0].status, f.enqueued.map((event) => event.depositOutcome)], ['CANCELLED', 'KEPT', ['KEPT']]);
  }
  assert.equal(errors.mock.callCount(), 0, 'a capture in flight is not a failure');
});

test('one failing booking does not stop the rest', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = fixture([
    { id: 'poison', date: minutes(-30), deposit: { status: 'CAPTURED' } },
    { id: 'fine', date: minutes(-20) },
  ], { failEnqueueFor: 'poison' });
  assert.deepEqual(await f.service.cancelLateArrivals(now), { enabled: true, cancelled: 1, skipped: 0, failed: 1 });
  assert.deepEqual(f.appointments.map((row) => [row.id, row.status, row.notificationVersion]), [['poison', 'CONFIRMED', 0], ['fine', 'CANCELLED', 1]]);
  assert.equal(f.appointments[0].lateCancelledAt, null);
  assert.equal(f.attempts[0].status, 'CAPTURED', 'the failed closing kept nothing: it stays due and is retried next run');
  assert.deepEqual(f.enqueued.map((event) => event.id), ['fine']);
  assert.deepEqual(f.audits.map((audit) => audit.targetId), ['fine']);
  assert.equal(f.counts.invalidations, 1);
});

test('no deposit: cancelled without deposit wording', async () => {
  const f = fixture([{ id: 'cash', date: minutes(-45) }]);
  assert.deepEqual(await f.service.cancelLateArrivals(now), { enabled: true, cancelled: 1, skipped: 0, failed: 0 });
  assert.equal(f.appointments[0].status, 'CANCELLED');
  assert.equal(f.enqueued[0].depositOutcome, undefined, 'no deposit wording');
  assert.deepEqual(f.enqueued, [{ id: 'cash', kind: 'LATE_CANCELLED', version: 1, notBefore: minutes(30) }]);
  assert.deepEqual(f.audits[0].metadata, { from: 'CONFIRMED', to: 'CANCELLED', start: minutes(-45).toISOString(), minutesLate: 45, notified: true });
});
