import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { SquareGatewayError, type SquarePayment } from './square-gateway';
import { OPERATIONS_MESSAGES } from './operations-messages';

const now = new Date('2099-09-01T12:00:00Z');
const minutes = (count: number) => new Date(now.getTime() + count * 60_000);
// Every fixture appointment lasts 60 minutes unless a row says otherwise, so a
// request that started 90 minutes ago has ended and one 30 minutes ago has not.
const ENDED = minutes(-90);

/** A card deposit as the fixture stores it (PaymentAttempt), tied to one request. */
type AttemptRow = {
  id: string; appointmentId: string; status: string; amountPence: number; squarePaymentId: string | null; delayedUntil: Date | null;
  environment: string; locationId: string; updatedAt: Date; lastError: string | null; voidedAt: Date | null;
};
type Row = {
  id: string; status: string; date: Date; notificationVersion: number; treatwellBookingId: string | null;
  treatwellSyncStatus: string; rescheduleRequestedDate: Date | null; rescheduleRequestedAt: Date | null;
  [key: string]: unknown;
};
type Hooks = {
  onBeforeTransaction?: (rows: Row[], attempts: AttemptRow[]) => void;
  onFindUnique?: (rows: Row[]) => void;
  failEnqueueFor?: string;
  salonPhone?: string;
  settingsReadFails?: boolean;
  invalidationFails?: boolean;
  /** How Square answers a release (default: released). */
  cancel?: () => Promise<unknown>;
  /** What Square says a deposit's payment is now (default: APPROVED, a hold). */
  squareStatus?: Record<string, SquarePayment['status'] | 'UNREACHABLE'>;
  /** How Square answers a refund (default: accepted, PENDING). */
  refund?: () => Promise<unknown>;
  /** No usable Square configuration here (payments switched off). */
  paymentsOff?: boolean;
};

type FixtureRow = {
  id: string; status?: string; date: Date; announced?: boolean; email?: string; treatwellBookingId?: string;
  /** The frozen duration (60 by default); null falls back to the service's. */
  durationAtBooking?: number | null;
  serviceDuration?: number;
  /** The request's card deposit. */
  deposit?: { status: string; delayedUntil: Date | null; amountPence?: number; updatedAt?: Date };
};

const SANDBOX = { environment: 'sandbox', accessToken: 'sandbox-token', applicationId: 'sandbox-sq0idb-fixture', locationId: 'fixture-location', webhookSignatureKey: 'key', webhookNotificationUrl: 'https://example.test/api/webhooks/square' };

/** A Prisma-style filter on a deposit row: equality, `in`, `lte`. */
function attemptMatches(attempt: AttemptRow | undefined, filter: Record<string, unknown>): boolean {
  if (!attempt) return false;
  return Object.entries(filter).every(([key, condition]) => {
    const value = attempt[key as keyof AttemptRow];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const { in: list, lte } = condition as { in?: unknown[]; lte?: Date };
      if (list) return list.includes(value);
      if (lte) return value instanceof Date && value <= lte;
      return false;
    }
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    return value === condition;
  });
}

function fixture(rows: FixtureRow[], hooks: Hooks = {}) {
  const appointments: Row[] = rows.map((row) => ({
    id: row.id, status: row.status ?? 'PENDING', date: row.date, notificationVersion: 0,
    treatwellBookingId: row.treatwellBookingId ?? null, treatwellSyncStatus: 'NOT_REQUIRED', treatwellSyncError: null,
    rescheduleRequestedDate: null, rescheduleRequestedAt: null, priceAtBooking: null,
    durationAtBooking: row.durationAtBooking === undefined ? 60 : row.durationAtBooking, notes: null,
    user: { email: row.email ?? `${row.id}@example.test`, name: 'Amy', phone: null },
    stylist: { name: 'Ivan', treatwellExternalId: null }, service: { id: 'svc', name: 'Cut', price: 40, duration: row.serviceDuration ?? 60, treatwellExternalId: null },
  }));
  const attempts: AttemptRow[] = rows.filter((row) => row.deposit).map((row) => ({
    id: `attempt-${row.id}`, appointmentId: row.id, status: row.deposit!.status, amountPence: row.deposit!.amountPence ?? 2000,
    squarePaymentId: `payment-${row.id}`, delayedUntil: row.deposit!.delayedUntil, environment: 'sandbox', locationId: 'fixture-location',
    updatedAt: row.deposit!.updatedAt ?? minutes(-24 * 60), lastError: null, voidedAt: null,
  }));
  /** Refunds of taken deposits (PaymentRefund), as the lifecycle writes them. */
  type RefundRow = { id: string; attemptId: string; idempotencyKey: string; squareRefundId: string | null; amountPence: number; status: string; reason: string; requestedById: string | null; updatedAt: Date };
  const refunds: RefundRow[] = [];
  const attemptFor = (appointmentId: string) => attempts.find((attempt) => attempt.appointmentId === appointmentId);
  const withDeposit = (row: Row) => ({ ...structuredClone(row), paymentAttempt: structuredClone(attemptFor(row.id) ?? null) });
  /** The candidate query's shape: status, `date.lte`, OR, NOT and the deposit relation. */
  const rowMatches = (row: Row, where: Record<string, unknown>): boolean => Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Record<string, unknown>[]).some((alternative) => rowMatches(row, alternative));
    if (key === 'NOT') return !rowMatches(row, condition as Record<string, unknown>);
    if (key === 'paymentAttempt') return attemptMatches(attemptFor(row.id), (condition as { is: Record<string, unknown> }).is);
    if (key === 'date') return row.date <= (condition as { lte: Date }).lte;
    return row[key] === condition;
  });
  // The REQUEST_RECEIVED notice an online request queued when it was made.
  const deliveries = rows.filter((row) => row.announced).map((row) => ({ id: `n-${row.id}`, appointmentId: row.id, kind: 'REQUEST_RECEIVED' }));
  const enqueued: { id: string; kind: string; version: number; salonPhone?: string; depositOutcome?: string; holdExpired?: boolean; deposit?: unknown }[] = [];
  const audits: { action: string; targetId: string; metadata: Record<string, unknown> }[] = [];
  const counts = { settingsReads: 0, transactions: 0, invalidations: 0 };
  const square = {
    cancel: [] as { paymentId: string; amountPence: number; referenceId: string }[],
    getPayment: [] as string[],
    refund: [] as { paymentId: string; amountPence: number; idempotencyKey: string }[],
  };
  const tx = {
    siteSettings: { findUnique: async () => {
      counts.settingsReads++;
      if (hooks.settingsReadFails) throw new Error('settings read failed');
      return hooks.salonPhone ? { phone: hooks.salonPhone } : null;
    } },
    appointment: {
      findMany: async ({ where, take }: { where: Record<string, unknown>; take: number }) => appointments
        .filter((row) => rowMatches(row, where))
        .slice(0, take).map((row) => ({ id: row.id })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = appointments.find((item) => item.id === where.id);
        const found = row ? withDeposit(row) : null;
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
    paymentAttempt: {
      findUnique: async ({ where }: { where: { id?: string; appointmentId?: string } }) =>
        structuredClone(attempts.find((attempt) => (where.id ? attempt.id === where.id : attempt.appointmentId === where.appointmentId)) ?? null),
      updateMany: async ({ where, data }: { where: Partial<AttemptRow>; data: Partial<AttemptRow> }) => {
        const matched = attempts.filter((attempt) => attemptMatches(attempt, where));
        // @updatedAt, as Prisma sets it (unless the write sets it itself).
        for (const attempt of matched) Object.assign(attempt, { updatedAt: now }, data);
        return { count: matched.length };
      },
    },
    paymentRefund: {
      findMany: async ({ where }: { where: { attemptId: string; status: { in: string[] } } }) =>
        refunds.filter((row) => row.attemptId === where.attemptId && where.status.in.includes(row.status)).map((row) => ({ amountPence: row.amountPence })),
      create: async ({ data }: { data: Omit<RefundRow, 'id' | 'squareRefundId' | 'updatedAt'> }) => {
        const row: RefundRow = { id: `refund-${refunds.length + 1}`, squareRefundId: null, updatedAt: now, ...data };
        refunds.push(row);
        return { id: row.id, amountPence: row.amountPence, idempotencyKey: row.idempotencyKey };
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = refunds.find((candidate) => candidate.id === where.id);
        return row ? { ...structuredClone(row), attempt: structuredClone(attempts.find((attempt) => attempt.id === row.attemptId)!) } : null;
      },
      updateMany: async ({ where, data }: { where: { id: string; status: string; updatedAt?: Date }; data: Partial<RefundRow> }) => {
        const matched = refunds.filter((row) => row.id === where.id && row.status === where.status
          && (where.updatedAt === undefined || row.updatedAt.getTime() === where.updatedAt.getTime()));
        for (const row of matched) Object.assign(row, { updatedAt: now }, data);
        return { count: matched.length };
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
  // A fake Square for the lapse step's calls: settling a capture nobody saw
  // finish (getPayment), releasing a hold (cancel), refunding a taken deposit.
  const gateway = {
    cancel: async (input: { paymentId: string; amountPence: number; referenceId: string }) => {
      square.cancel.push(input);
      if (hooks.cancel) return hooks.cancel();
      return { id: input.paymentId, status: 'CANCELED', amount_money: { amount: input.amountPence, currency: 'GBP' }, location_id: 'fixture-location', source_type: 'CARD', reference_id: input.referenceId };
    },
    getPayment: async (paymentId: string) => {
      square.getPayment.push(paymentId);
      const attempt = attempts.find((row) => row.squarePaymentId === paymentId)!;
      const status = hooks.squareStatus?.[attempt.appointmentId] ?? 'APPROVED';
      if (status === 'UNREACHABLE') throw new SquareGatewayError('unknown_outcome');
      return {
        id: paymentId, status, amount_money: { amount: attempt.amountPence, currency: 'GBP' }, location_id: 'fixture-location', source_type: 'CARD',
        reference_id: attempt.id, version_token: 'v1', delay_action: 'CANCEL', delayed_until: minutes(3 * 24 * 60).toISOString(),
      };
    },
    refund: async (input: { paymentId: string; amountPence: number; idempotencyKey: string }) => {
      square.refund.push(input);
      if (hooks.refund) return hooks.refund();
      return { id: `square-${input.idempotencyKey}`, payment_id: input.paymentId, location_id: 'fixture-location', status: 'PENDING', amount_money: { amount: input.amountPence, currency: 'GBP' } };
    },
  };
  const deposits = loadServerModule<typeof import('./deposit-lifecycle')>('src/app/services/deposit-lifecycle.ts', {
    '@/app/lib/online-booking-lock': { usableSquareConfig: () => (hooks.paymentsOff ? null : SANDBOX) },
    './square-gateway': { createSquareGateway: () => gateway },
  });
  const service = loadServerModule<typeof import('./pending-request-lapse')>('src/app/services/pending-request-lapse.ts', {
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
        _db: unknown, kind: string, appointment: Row & { user: { email: string }; paymentAttempt?: unknown },
        options: { salonPhone?: string; depositOutcome?: string; holdExpired?: boolean },
      ) => {
        if (hooks.failEnqueueFor === appointment.id) throw new Error('enqueue failed');
        // The real outbox writes nothing for an undeliverable placeholder address.
        if (appointment.user.email.endsWith('.invalid')) return null;
        enqueued.push({
          id: appointment.id, kind, version: appointment.notificationVersion,
          ...(options.salonPhone ? { salonPhone: options.salonPhone } : {}),
          ...(options.depositOutcome ? { depositOutcome: options.depositOutcome, deposit: appointment.paymentAttempt } : {}),
          ...(options.holdExpired ? { holdExpired: true } : {}),
        });
        return { id: 'e' };
      },
    },
    './stylist-ical-cache': { invalidateStylistIcalFeedFromCron: () => {
      counts.invalidations++;
      if (hooks.invalidationFails) throw new Error('no cache in this context');
    } },
  });
  return { service, appointments, attempts, refunds, enqueued, audits, counts, square };
}

test('a request whose appointment has ended is cancelled once, with one lapse email and one audit', async () => {
  const f = fixture([
    { id: 'long-over', date: ENDED, announced: true },
    { id: 'just-ended', date: minutes(-60), announced: true },
    { id: 'ahead', date: minutes(1), announced: true },
    { id: 'confirmed', status: 'CONFIRMED', date: ENDED },
    { id: 'cancelled', status: 'CANCELLED', date: ENDED },
  ]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 2, failed: 0 });
  assert.deepEqual(f.appointments.map((row) => [row.id, row.status]), [
    ['long-over', 'CANCELLED'], ['just-ended', 'CANCELLED'], ['ahead', 'PENDING'], ['confirmed', 'CONFIRMED'], ['cancelled', 'CANCELLED'],
  ]);
  assert.deepEqual(f.appointments.slice(0, 2).map((row) => row.notificationVersion), [1, 1], 'earlier queued request mail is retired');
  assert.deepEqual(f.enqueued.map((event) => [event.id, event.kind, event.version]), [['long-over', 'REQUEST_LAPSED', 1], ['just-ended', 'REQUEST_LAPSED', 1]]);
  assert.deepEqual(f.audits.map((audit) => [audit.action, audit.targetId]), [['APPOINTMENT.LAPSED', 'long-over'], ['APPOINTMENT.LAPSED', 'just-ended']]);
  assert.deepEqual(f.audits[0].metadata, { from: 'PENDING', to: 'CANCELLED', start: ENDED.toISOString(), notified: true });
  assert.equal(f.counts.transactions, 2, 'each lapse runs in its own serializable transaction');
  assert.equal(f.counts.invalidations, 1, 'the busy feed is dropped once per run that changed something');

  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 0, failed: 0 }, 're-running is a no-op');
  assert.equal(f.enqueued.length, 2);
  assert.equal(f.counts.invalidations, 1);
});

// A staff "pencil in" is PENDING too, and its customer may be in the chair:
// cancelling it mid-visit would drop it from the busy feed and let Fresha sell
// the rest of that time. Staff can mark it completed meanwhile instead.
test('a request whose appointment has started but not ended is left alone, and is not a failure', async () => {
  const f = fixture([
    { id: 'at-start', date: now, announced: true },
    { id: 'under-way', date: minutes(-30) },
    { id: 'last-minute', date: minutes(-59), announced: true },
  ]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 0, failed: 0 });
  assert.deepEqual(f.appointments.map((row) => [row.status, row.notificationVersion]), [['PENDING', 0], ['PENDING', 0], ['PENDING', 0]]);
  assert.equal(f.enqueued.length, 0);
  assert.equal(f.audits.length, 0);
  assert.equal(f.counts.invalidations, 0, 'nothing changed, so the busy feed keeps holding the chair');

  // Once each has ended, the next run closes it.
  assert.deepEqual(await f.service.lapseStartedPendingRequests(minutes(60)), { lapsed: 3, failed: 0 });
  assert.deepEqual(f.appointments.map((row) => row.status), ['CANCELLED', 'CANCELLED', 'CANCELLED']);
  assert.deepEqual(f.enqueued.map((event) => event.id), ['at-start', 'last-minute'], 'the pencil-in is still closed silently');
});

test('the end comes from the frozen duration, falling back to the service duration', async () => {
  const f = fixture([
    { id: 'long-booking', date: minutes(-60), durationAtBooking: 90 },
    { id: 'no-frozen-duration', date: minutes(-30), durationAtBooking: null, serviceDuration: 30 },
    { id: 'no-frozen-long-service', date: minutes(-30), durationAtBooking: null, serviceDuration: 45 },
  ]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
  assert.deepEqual(f.appointments.map((row) => [row.id, row.status]), [
    ['long-booking', 'PENDING'], ['no-frozen-duration', 'CANCELLED'], ['no-frozen-long-service', 'PENDING'],
  ]);
});

// Staff "pencil in" bookings are PENDING too, but nobody told the customer they
// were awaiting confirmation (no REQUEST_RECEIVED), so there is nobody to tell
// that it lapsed — often the customer simply came in.
test('a pencilled-in booking the customer was never told about is closed without an email', async () => {
  const f = fixture([{ id: 'pencil', date: ENDED }]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
  assert.equal(f.appointments[0].status, 'CANCELLED');
  assert.deepEqual(f.enqueued, []);
  assert.equal(f.audits[0].metadata.notified, false);
});

// A backlog (first deploy, or crons switched off for a while) is closed without
// telling anyone days later that their request "could not be confirmed".
test('a request whose time passed more than 72 hours ago is closed without an email', async () => {
  const f = fixture([
    { id: 'stale', date: minutes(-72 * 60 - 1), announced: true },
    { id: 'recent', date: minutes(-72 * 60), announced: true },
  ]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 2, failed: 0 });
  assert.deepEqual(f.appointments.map((row) => row.status), ['CANCELLED', 'CANCELLED']);
  assert.deepEqual(f.enqueued.map((event) => event.id), ['recent']);
  assert.deepEqual(f.audits.map((audit) => audit.metadata.notified), [false, true]);
});

test('an undeliverable address is closed without an email and recorded as not notified', async () => {
  const f = fixture([{ id: 'walk-in', date: ENDED, announced: true, email: 'x@walk-in.harbourhair.invalid' }]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
  assert.deepEqual(f.enqueued, []);
  assert.equal(f.audits[0].metadata.notified, false);
});

test('a request confirmed or moved after the candidate read is left alone', async () => {
  const confirmed = fixture([{ id: 'r', date: ENDED, announced: true }], { onBeforeTransaction: (rows) => { rows[0].status = 'CONFIRMED'; } });
  assert.deepEqual(await confirmed.service.lapseStartedPendingRequests(now), { lapsed: 0, failed: 0 });
  assert.equal(confirmed.appointments[0].status, 'CONFIRMED');
  const moved = fixture([{ id: 'r', date: ENDED, announced: true }], { onBeforeTransaction: (rows) => { rows[0].date = minutes(24 * 60); } });
  assert.deepEqual(await moved.service.lapseStartedPendingRequests(now), { lapsed: 0, failed: 0 });
  assert.equal(moved.appointments[0].status, 'PENDING');
  assert.deepEqual([...confirmed.enqueued, ...moved.enqueued, ...confirmed.audits, ...moved.audits], []);
  assert.equal(confirmed.counts.invalidations + moved.counts.invalidations, 0);
});

test('when the conditional write loses the race nothing is emailed or audited', async () => {
  const f = fixture([{ id: 'race', date: ENDED, announced: true }], { onFindUnique: (rows) => { rows[0].date = minutes(60); } });
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 0, failed: 0 });
  assert.equal(f.appointments[0].status, 'PENDING');
  assert.deepEqual(f.enqueued, []);
  assert.deepEqual(f.audits, []);
});

test('a row that throws is rolled back and skipped without stopping the rest', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = fixture([{ id: 'poison', date: minutes(-80), announced: true }, { id: 'fine', date: minutes(-70), announced: true }], { failEnqueueFor: 'poison' });
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
  const f = fixture([{ id: 'one', date: minutes(-80), announced: true }, { id: 'two', date: minutes(-70), announced: true }], { salonPhone: '07831 830898' });
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 2, failed: 0 });
  assert.deepEqual(f.enqueued.map((event) => event.salonPhone), ['07831 830898', '07831 830898']);
  assert.equal(f.counts.settingsReads, 1);

  t.mock.method(console, 'error', () => {});
  const failing = fixture([{ id: 'one', date: minutes(-80), announced: true }], { salonPhone: '07831 830898', settingsReadFails: true });
  assert.deepEqual(await failing.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
  assert.equal(failing.enqueued[0].salonPhone, undefined);
});

test('a failing feed invalidation never fails the run (the cache heals within a day)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = fixture([{ id: 'r', date: ENDED, announced: true }], { invalidationFails: true });
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
});

test('a request already sent to Treatwell is queued for cancellation there, like a staff cancellation', async () => {
  const f = fixture([{ id: 'synced', date: ENDED, treatwellBookingId: 'tw-1' }, { id: 'local', date: ENDED }]);
  await f.service.lapseStartedPendingRequests(now);
  assert.deepEqual(f.appointments.map((row) => row.treatwellSyncStatus), ['PENDING', 'NOT_REQUIRED']);
});

// Card deposits (docs/superpowers/specs/2026-10-13-square-deposits-design.md, S3).
const LIVE_HOLD = { status: 'AUTHORIZED', delayedUntil: minutes(3 * 24 * 60) };
const RUN_OUT_HOLD = { status: 'AUTHORIZED', delayedUntil: minutes(-5) };

test('a lapsed request releases its card hold after the lapse commits, and the email says so', async () => {
  const f = fixture([{ id: 'held', date: ENDED, announced: true, deposit: LIVE_HOLD }]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
  assert.equal(f.appointments[0].status, 'CANCELLED');
  assert.deepEqual(f.square.cancel, [{ paymentId: 'payment-held', amountPence: 2000, referenceId: 'attempt-held' }], 'released once, by its own payment');
  assert.equal(f.attempts[0].status, 'VOIDED');
  assert.ok(f.attempts[0].voidedAt instanceof Date);
  assert.deepEqual(f.enqueued, [{ id: 'held', kind: 'REQUEST_LAPSED', version: 1, depositOutcome: 'RELEASED', deposit: { status: 'AUTHORIZED', amountPence: 2000 } }]);
  assert.deepEqual(f.audits[0].metadata, { from: 'PENDING', to: 'CANCELLED', start: ENDED.toISOString(), notified: true, deposit: 'RELEASED', depositPence: 2000 });
  // A re-run touches nothing: the request is closed and the hold released.
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 0, failed: 0 });
  assert.equal(f.square.cancel.length, 1);
});

test('a request whose card hold ran out lapses before its time, without asking Square, and says why', async () => {
  const ahead = minutes(5 * 24 * 60);
  const f = fixture([
    { id: 'run-out', date: ahead, announced: true, deposit: RUN_OUT_HOLD },
    { id: 'still-held', date: ahead, announced: true, deposit: LIVE_HOLD },
    { id: 'no-deposit', date: ahead, announced: true },
  ]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
  assert.deepEqual(f.appointments.map((row) => [row.id, row.status]), [['run-out', 'CANCELLED'], ['still-held', 'PENDING'], ['no-deposit', 'PENDING']]);
  assert.equal(f.attempts[0].status, 'EXPIRED');
  assert.equal(f.attempts[0].lastError, OPERATIONS_MESSAGES.PAYMENT_HOLD_EXPIRED);
  assert.equal(f.attempts[1].status, 'AUTHORIZED', 'a live hold on a future request is left alone');
  assert.deepEqual(f.square.cancel, [], 'Square drops a hold that ran out by itself');
  assert.deepEqual(f.enqueued, [{ id: 'run-out', kind: 'REQUEST_LAPSED', version: 1, depositOutcome: 'RELEASED', deposit: { status: 'AUTHORIZED', amountPence: 2000 }, holdExpired: true }]);
  assert.deepEqual(f.audits[0].metadata, { from: 'PENDING', to: 'CANCELLED', start: ahead.toISOString(), notified: true, deposit: 'EXPIRED', depositPence: 2000 });
  assert.equal(f.counts.invalidations, 1, 'the request leaves the busy feed');
});

test('a request whose hold Square already let go (EXPIRED by the webhook or reconciliation) lapses before its time too', async () => {
  const ahead = minutes(5 * 24 * 60);
  // Square cancelled the hold early (released in the Square Dashboard, say):
  // its expiry is still ahead, but the request can never be confirmed now.
  const f = fixture([{ id: 'gone', date: ahead, announced: true, deposit: { status: 'EXPIRED', delayedUntil: LIVE_HOLD.delayedUntil } }]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
  assert.equal(f.appointments[0].status, 'CANCELLED');
  assert.equal(f.attempts[0].status, 'EXPIRED');
  assert.deepEqual(f.square.cancel, [], 'nothing is held, so nothing is asked of Square');
  assert.deepEqual(f.enqueued, [{ id: 'gone', kind: 'REQUEST_LAPSED', version: 1, depositOutcome: 'RELEASED', deposit: { status: 'EXPIRED', amountPence: 2000 }, holdExpired: true }]);
  assert.deepEqual(f.audits[0].metadata, { from: 'PENDING', to: 'CANCELLED', start: ahead.toISOString(), notified: true, deposit: 'EXPIRED', depositPence: 2000 });
});

test('a hold that ran out on a request whose time has also passed lapses as usual: the time-passed wording', async () => {
  const f = fixture([{ id: 'both', date: ENDED, announced: true, deposit: RUN_OUT_HOLD }]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
  assert.equal(f.attempts[0].status, 'EXPIRED');
  assert.deepEqual(f.square.cancel, []);
  assert.equal(f.enqueued[0].holdExpired, undefined);
  assert.equal(f.enqueued[0].depositOutcome, 'RELEASED');
});

test('a request whose deposit is being taken, unanswered or taken is left to staff while its time is ahead', async () => {
  for (const status of ['CAPTURING', 'CAPTURE_UNKNOWN', 'CAPTURED']) {
    const f = fixture([{ id: 'busy', date: minutes(3 * 24 * 60), announced: true, deposit: { status, delayedUntil: minutes(-5) } }]);
    assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 0, failed: 0 }, status);
    assert.equal(f.appointments[0].status, 'PENDING', status);
    assert.equal(f.attempts[0].status, status);
    assert.deepEqual([f.enqueued, f.square.cancel, f.square.getPayment, f.audits], [[], [], [], []]);
    assert.equal(f.counts.transactions, 0, `${status}: never even a candidate`);
  }
});

// Money-safety review W3: a deposit taken (or maybe taken) for a request
// nobody confirmed used to be skipped forever; approval is refused once the
// time has come, so nothing ever gave it back. The lapse step settles it with
// Square and closes the request exactly like a staff decline: CANCELLED,
// refunded in full, and the customer told.
// Review I-E: but only from the DAILY housekeeping run, and only once the
// appointment ended at least 12 hours earlier — the first notifications run
// after the visit used to refund a customer who had just been served, before
// staff could mark the visit completed (which keeps the deposit).
const TAKEN = { status: 'CAPTURED', delayedUntil: minutes(2 * 24 * 60) };
/** The daily housekeeping run's call (api/cron/housekeeping/route.ts). */
const HOUSEKEEPING = { takenDeposits: true } as const;
/** Started 13½ hours ago: its 60-minute appointment ended 12½ hours ago. */
const ENDED_LONG_AGO = minutes(-13 * 60 - 30);

test('a request whose deposit was taken but never confirmed is cancelled and refunded in full by the daily run 12 hours after it ended, and told so', async () => {
  const f = fixture([{ id: 'taken', date: ENDED_LONG_AGO, announced: true, deposit: TAKEN }]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now, HOUSEKEEPING), { lapsed: 1, failed: 0 });
  assert.equal(f.appointments[0].status, 'CANCELLED');
  assert.equal(f.attempts[0].status, 'CAPTURED', 'taken, now on its way back');
  assert.deepEqual(f.refunds.map((row) => [row.reason, row.amountPence, row.requestedById, row.status]), [['REQUEST_LAPSED', 2000, null, 'PENDING']]);
  assert.deepEqual(f.square.refund, [{ paymentId: 'payment-taken', amountPence: 2000, idempotencyKey: f.refunds[0].idempotencyKey }], 'asked after the commit, with the row\'s key');
  assert.deepEqual(f.square.cancel, []);
  assert.deepEqual(f.enqueued, [{ id: 'taken', kind: 'REQUEST_LAPSED', version: 1, depositOutcome: 'REFUNDING', deposit: { status: 'CAPTURED', amountPence: 2000 } }]);
  assert.deepEqual(f.audits[0].metadata, { from: 'PENDING', to: 'CANCELLED', start: ENDED_LONG_AGO.toISOString(), notified: true, deposit: 'REFUNDING', depositPence: 2000 });
  // A re-run never refunds twice.
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now, HOUSEKEEPING), { lapsed: 0, failed: 0 });
  assert.equal(f.refunds.length, 1);
  assert.equal(f.square.refund.length, 1);
});

test('a taken deposit is never lapsed by the notifications run, and by the daily run only 12 hours after the appointment ended', async () => {
  // In the chair now: its 60 minutes end in 30 minutes.
  const f = fixture([{ id: 'in-the-chair', date: minutes(-30), announced: true, deposit: TAKEN }]);
  const afterEnd = (hours: number) => minutes(30 + hours * 60);
  // The notifications cron, however long after the visit: never.
  for (const at of [now, afterEnd(1), afterEnd(13), afterEnd(48)]) {
    assert.deepEqual(await f.service.lapseStartedPendingRequests(at), { lapsed: 0, failed: 0 }, at.toISOString());
  }
  // The daily run within 12 hours of the end: still staff's to mark completed (kept) or decline (refunded).
  for (const at of [now, afterEnd(1), afterEnd(11.9)]) {
    assert.deepEqual(await f.service.lapseStartedPendingRequests(at, HOUSEKEEPING), { lapsed: 0, failed: 0 }, `daily ${at.toISOString()}`);
  }
  assert.deepEqual([f.appointments[0].status, f.refunds, f.square.refund, f.square.getPayment, f.enqueued, f.counts.transactions], ['PENDING', [], [], [], [], 0]);
  // 12 hours on, the daily run refunds it in full.
  assert.deepEqual(await f.service.lapseStartedPendingRequests(afterEnd(12), HOUSEKEEPING), { lapsed: 1, failed: 0 });
  assert.deepEqual(f.refunds.map((row) => row.reason), ['REQUEST_LAPSED']);
});

test('a request picked as due whose deposit was taken meanwhile is left to staff by the notifications run', async () => {
  // Due (its hold looked live when it was read); taken before its lapse could commit.
  const f = fixture([{ id: 'raced', date: ENDED, announced: true, deposit: LIVE_HOLD }], {
    onBeforeTransaction: (_rows, attempts) => { attempts[0].status = 'CAPTURED'; },
  });
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 0, failed: 0 });
  assert.deepEqual([f.appointments[0].status, f.refunds, f.square.cancel, f.square.refund, f.enqueued], ['PENDING', [], [], [], []]);
});

test('an ended request whose capture nobody saw finish is settled with Square first: taken ⇒ refunded, still held ⇒ released, dropped ⇒ closed', async () => {
  const quiet = minutes(-10);
  const f = fixture([
    { id: 'taken', date: ENDED_LONG_AGO, announced: true, deposit: { status: 'CAPTURE_UNKNOWN', delayedUntil: minutes(2 * 24 * 60), updatedAt: quiet } },
    { id: 'held', date: ENDED_LONG_AGO, announced: true, deposit: { status: 'CAPTURING', delayedUntil: minutes(2 * 24 * 60), updatedAt: quiet } },
    { id: 'dropped', date: ENDED_LONG_AGO, announced: true, deposit: { status: 'CAPTURE_UNKNOWN', delayedUntil: minutes(2 * 24 * 60), updatedAt: quiet } },
  ], { squareStatus: { taken: 'COMPLETED', held: 'APPROVED', dropped: 'CANCELED' } });
  // The notifications run never settles them.
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 0, failed: 0 });
  assert.deepEqual(f.square.getPayment, []);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now, HOUSEKEEPING), { lapsed: 3, failed: 0 });
  assert.deepEqual(f.appointments.map((row) => row.status), ['CANCELLED', 'CANCELLED', 'CANCELLED']);
  assert.deepEqual(f.square.getPayment.sort(), ['payment-dropped', 'payment-held', 'payment-taken'], 'each read once, never captured');
  assert.deepEqual(f.attempts.map((row) => [row.appointmentId, row.status]), [['taken', 'CAPTURED'], ['held', 'VOIDED'], ['dropped', 'EXPIRED']]);
  assert.deepEqual(f.refunds.map((row) => [row.attemptId, row.reason, row.amountPence]), [['attempt-taken', 'REQUEST_LAPSED', 2000]]);
  assert.deepEqual(f.square.refund.map((call) => call.paymentId), ['payment-taken']);
  assert.deepEqual(f.square.cancel.map((call) => call.paymentId), ['payment-held'], 'the hold Square still had is released');
  assert.deepEqual(Object.fromEntries(f.enqueued.map((event) => [event.id, event.depositOutcome])), { taken: 'REFUNDING', held: 'RELEASED', dropped: 'RELEASED' });
});

test('a capture still settling, or one Square cannot answer about, waits for a later run', async () => {
  const fresh = fixture([
    // Went unanswered a minute ago: the capture may still land (CAPTURE_STALE_MS).
    { id: 'unanswered', date: ENDED_LONG_AGO, announced: true, deposit: { status: 'CAPTURE_UNKNOWN', delayedUntil: minutes(60), updatedAt: minutes(-1) } },
    { id: 'claimed', date: ENDED_LONG_AGO, announced: true, deposit: { status: 'CAPTURING', delayedUntil: minutes(60), updatedAt: minutes(-1) } },
  ], { squareStatus: { unanswered: 'COMPLETED', claimed: 'COMPLETED' } });
  assert.deepEqual(await fresh.service.lapseStartedPendingRequests(now, HOUSEKEEPING), { lapsed: 0, failed: 0 });
  assert.deepEqual([fresh.appointments.map((row) => row.status), fresh.square.getPayment, fresh.refunds], [['PENDING', 'PENDING'], [], []]);
  assert.deepEqual(fresh.attempts.map((row) => row.status), ['CAPTURE_UNKNOWN', 'CAPTURING']);

  const silent = fixture([{ id: 'silent', date: ENDED_LONG_AGO, announced: true, deposit: { status: 'CAPTURE_UNKNOWN', delayedUntil: minutes(60), updatedAt: minutes(-10) } }], { squareStatus: { silent: 'UNREACHABLE' } });
  assert.deepEqual(await silent.service.lapseStartedPendingRequests(now, HOUSEKEEPING), { lapsed: 0, failed: 0 });
  assert.deepEqual([silent.appointments[0].status, silent.attempts[0].status, silent.enqueued], ['PENDING', 'CAPTURE_UNKNOWN', []]);

  const off = fixture([{ id: 'off', date: ENDED_LONG_AGO, announced: true, deposit: { status: 'CAPTURE_UNKNOWN', delayedUntil: minutes(60), updatedAt: minutes(-10) } }], { paymentsOff: true });
  assert.deepEqual(await off.service.lapseStartedPendingRequests(now, HOUSEKEEPING), { lapsed: 0, failed: 0 });
  assert.deepEqual([off.appointments[0].status, off.square.getPayment], ['PENDING', []]);
});

test('a lapse whose refund Square does not answer still stands; the refund is left for reconciliation', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = fixture([{ id: 'taken', date: ENDED_LONG_AGO, announced: true, deposit: TAKEN }], { refund: async () => { throw new SquareGatewayError('unknown_outcome'); } });
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now, HOUSEKEEPING), { lapsed: 1, failed: 0 });
  assert.equal(f.appointments[0].status, 'CANCELLED');
  assert.deepEqual(f.refunds.map((row) => [row.reason, row.status]), [['REQUEST_LAPSED', 'UNKNOWN']]);
  // Payments switched off here: the refund row waits, unsent, for a deployment that can send it.
  const off = fixture([{ id: 'taken', date: ENDED_LONG_AGO, announced: true, deposit: TAKEN }], { paymentsOff: true });
  assert.deepEqual(await off.service.lapseStartedPendingRequests(now, HOUSEKEEPING), { lapsed: 1, failed: 0 });
  assert.deepEqual([off.refunds.map((row) => row.status), off.square.refund], [['REQUESTED'], []]);
});

// Money-safety review W4: a hold that is already gone — released by this site
// (VOIDED: a booking whose answer was lost, say) or dropped by Square
// (EXPIRED) — can never be confirmed, so its request closes now, with the
// hold-ended wording, rather than holding the slot until its time has passed.
test('a request whose hold this site already released (VOIDED) lapses before its time, without asking Square', async () => {
  const ahead = minutes(9 * 24 * 60);
  const f = fixture([{ id: 'released', date: ahead, announced: true, deposit: { status: 'VOIDED', delayedUntil: LIVE_HOLD.delayedUntil } }]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
  assert.equal(f.appointments[0].status, 'CANCELLED');
  assert.equal(f.attempts[0].status, 'VOIDED');
  assert.deepEqual([f.square.cancel, f.square.getPayment, f.square.refund], [[], [], []], 'nothing is held, so nothing is asked of Square');
  assert.deepEqual(f.enqueued, [{ id: 'released', kind: 'REQUEST_LAPSED', version: 1, depositOutcome: 'RELEASED', deposit: { status: 'VOIDED', amountPence: 2000 }, holdExpired: true }]);
  assert.deepEqual(f.audits[0].metadata, { from: 'PENDING', to: 'CANCELLED', start: ahead.toISOString(), notified: true, deposit: 'RELEASED', depositPence: 2000 });
  assert.equal(f.counts.invalidations, 1, 'the slot leaves the busy feed');
});

test('a hold that cannot be released stays AUTHORIZED for reconciliation; the lapse itself stands', async (t) => {
  t.mock.method(console, 'error', () => {});
  const failing = fixture([{ id: 'held', date: ENDED, announced: true, deposit: LIVE_HOLD }], { cancel: async () => { throw new SquareGatewayError('unknown_outcome'); } });
  assert.deepEqual(await failing.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
  assert.equal(failing.appointments[0].status, 'CANCELLED');
  assert.equal(failing.attempts[0].status, 'AUTHORIZED');
  assert.equal(failing.attempts[0].lastError, OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED);

  const off = fixture([{ id: 'held', date: ENDED, announced: true, deposit: LIVE_HOLD }], { paymentsOff: true });
  assert.deepEqual(await off.service.lapseStartedPendingRequests(now), { lapsed: 1, failed: 0 });
  assert.deepEqual(off.square.cancel, [], 'no Square call without a usable configuration');
  assert.equal(off.attempts[0].status, 'AUTHORIZED');
  assert.equal(off.attempts[0].lastError, OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED);
});

test('a hold released or dropped earlier is not released again', async () => {
  const f = fixture([
    { id: 'voided', date: ENDED, announced: true, deposit: { status: 'VOIDED', delayedUntil: LIVE_HOLD.delayedUntil } },
    { id: 'expired', date: ENDED, announced: true, deposit: { status: 'EXPIRED', delayedUntil: RUN_OUT_HOLD.delayedUntil } },
  ]);
  assert.deepEqual(await f.service.lapseStartedPendingRequests(now), { lapsed: 2, failed: 0 });
  assert.deepEqual(f.square.cancel, []);
  assert.deepEqual(f.enqueued.map((event) => event.depositOutcome), ['RELEASED', 'RELEASED'], 'the customer still hears nothing was taken');
});
