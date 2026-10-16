import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { bookingErrorText } from '../services/booking-errors';

// Staff record that a customer is here (markArrived), and undo the late-arrival
// rule within 24 hours (restoreLateCancellation):
// docs/superpowers/specs/2026-10-16-late-arrival-auto-cancel-design.md §4.1, §4.3.
// Date is mocked, so every window boundary is exact.
const NOW = new Date('2099-09-01T12:00:00Z');
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);
before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

type Row = Record<string, unknown>;
type FixtureOptions = {
  role?: 'ADMIN' | 'USER';
  status?: string;
  date?: Date;
  arrivedAt?: Date | null;
  lateCancelledAt?: Date | null;
  /** The booking's card deposit, by status; omitted: none. */
  deposit?: string;
  clashes?: Row[];
  /** Runs between the action's read and its write: another request got there first. */
  afterRead?: (state: { appointment: Row; attempt: Row | null }) => void;
};

function same(actual: unknown, expected: unknown): boolean {
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
  return actual === expected;
}

function fixture(options: FixtureOptions = {}) {
  const state = {
    appointment: {
      id: 'appointment-1', userId: 'user-1', stylistId: 'stylist-1',
      date: options.date ?? minutes(-20), status: options.status ?? 'CONFIRMED', durationAtBooking: 45,
      arrivedAt: options.arrivedAt ?? null, lateCancelledAt: options.lateCancelledAt ?? null, notificationVersion: 1,
      service: { duration: 60 },
    } as Row,
    attempt: (options.deposit ? { id: 'attempt-1', status: options.deposit } : null) as Row | null,
  };
  const audits: { action: string; actorUserId: string | null; targetId: string; metadata: Row }[] = [];
  const clashChecks: { client: unknown; target: Row }[] = [];
  const counts = { reads: 0, writes: 0, invalidations: 0 };
  let transactionActive = false;
  // What a rollback returns to: the state when the transaction began, plus any
  // change another request committed meanwhile (afterRead).
  let snapshot: { appointment: Row; attempt: Row | null; audits: typeof audits } | null = null;

  const tx = {
    appointment: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        counts.reads++;
        if (where.id !== state.appointment.id) return null;
        const row = { ...structuredClone(state.appointment), paymentAttempt: structuredClone(state.attempt) };
        if (options.afterRead) {
          options.afterRead(state);
          if (snapshot) options.afterRead(snapshot);
        }
        return row;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        counts.writes++;
        if (!Object.entries(where).every(([key, expected]) => same(state.appointment[key], expected))) return { count: 0 };
        for (const [key, value] of Object.entries(data)) {
          state.appointment[key] = value && typeof value === 'object' && 'increment' in value
            ? Number(state.appointment[key]) + Number((value as { increment: number }).increment)
            : value;
        }
        return { count: 1 };
      },
    },
    paymentAttempt: {
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        counts.writes++;
        const attempt = state.attempt;
        if (!attempt || !Object.entries(where).every(([key, expected]) => same(attempt[key], expected))) return { count: 0 };
        Object.assign(attempt, data);
        return { count: 1 };
      },
    },
    auditEvent: {
      create: async ({ data }: { data: { action: string; actorUserId: string | null; targetId: string; metadataJson: string } }) => {
        audits.push({ action: data.action, actorUserId: data.actorUserId, targetId: data.targetId, metadata: JSON.parse(data.metadataJson) });
        return { id: 'audit' };
      },
    },
  };
  // All or nothing, as on PostgreSQL: a throw rolls every write back.
  const db = {
    ...tx,
    $transaction: async (fn: (client: unknown) => unknown) => {
      const begun = structuredClone({ ...state, audits: [...audits] });
      snapshot = begun;
      transactionActive = true;
      try {
        return await fn(tx);
      } catch (error) {
        state.appointment = begun.appointment;
        state.attempt = begun.attempt;
        audits.splice(0, audits.length, ...begun.audits);
        throw error;
      } finally {
        transactionActive = false;
        snapshot = null;
      }
    },
  };

  const actions = loadServerModule<typeof import('./admin-arrivals')>('src/app/actions/admin-arrivals.ts', {
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: options.role ?? 'ADMIN' }) },
    '@/app/services/booking-service': { runSerializableWithRetry: async (fn: (client: unknown) => unknown) => db.$transaction(fn) },
    '@/app/services/admin-move-clashes': {
      describeAdminMoveClashes: async (client: unknown, target: Row) => {
        clashChecks.push({ client, target });
        return options.clashes ?? [];
      },
    },
    '@/app/services/stylist-ical-cache': {
      invalidateStylistIcalFeed: () => {
        assert.equal(transactionActive, false, 'the busy feed is refreshed after the commit');
        counts.invalidations++;
      },
    },
    'next/cache': { revalidatePath: () => undefined },
  });
  return { actions, state, audits, clashChecks, counts, tx };
}

const text = (code: Parameters<typeof bookingErrorText>[1]) => bookingErrorText('en-GB', code);
const OVERLAP = { kind: 'OVERLAP', appointmentId: 'other', customerName: 'Mei L.', start: minutes(-10), end: minutes(50) };

test('non-admins are refused', async () => {
  const f = fixture({ role: 'USER' });
  assert.deepEqual(await f.actions.markArrived('appointment-1', true), { success: false, error: text('NOT_AUTHORISED') });
  const g = fixture({ role: 'USER', status: 'CANCELLED', lateCancelledAt: minutes(-5), deposit: 'KEPT' });
  assert.deepEqual(await g.actions.restoreLateCancellation('appointment-1', { force: true }), { success: false, error: text('NOT_AUTHORISED') });
  for (const { counts, audits } of [f, g]) {
    assert.equal(counts.reads, 0, 'refused before anything is read');
    assert.equal(counts.writes, 0);
    assert.deepEqual(audits, []);
    assert.equal(counts.invalidations, 0);
  }
  assert.equal(f.state.appointment.arrivedAt, null);
  assert.equal(g.state.appointment.status, 'CANCELLED');
  assert.equal(g.state.attempt?.status, 'KEPT');
});

test('marks a CONFIRMED booking arrived inside the window, audited', async () => {
  // Opens an hour before the start; closes at the later of the end and start + 120 minutes.
  for (const date of [minutes(60), NOW, minutes(-20), minutes(-120)]) {
    const f = fixture({ date });
    assert.deepEqual(await f.actions.markArrived('appointment-1', true), { success: true });
    assert.deepEqual(f.state.appointment.arrivedAt, NOW);
    assert.equal(f.state.appointment.status, 'CONFIRMED');
    assert.equal(f.state.appointment.notificationVersion, 1, 'no email is retired or sent');
    assert.deepEqual(f.audits, [{ action: 'APPOINTMENT.ARRIVED', actorUserId: 'admin-1', targetId: 'appointment-1', metadata: {} }]);
    assert.equal(f.counts.invalidations, 0, 'an arrival changes nothing in the busy feed');
  }
  // A long service stays open until it ends.
  const long = fixture({ date: minutes(-170) });
  long.state.appointment.durationAtBooking = 180;
  assert.deepEqual(await long.actions.markArrived('appointment-1', true), { success: true });
  assert.deepEqual(long.state.appointment.arrivedAt, NOW);

  // Already arrived: the first time is kept, nothing is written.
  const earlier = minutes(-10);
  const again = fixture({ arrivedAt: earlier });
  assert.deepEqual(await again.actions.markArrived('appointment-1', true), { success: true });
  assert.deepEqual(again.state.appointment.arrivedAt, earlier);
  assert.equal(again.counts.writes, 0);
  assert.deepEqual(again.audits, []);
});

test('clearing an arrival', async () => {
  const f = fixture({ arrivedAt: minutes(-15) });
  assert.deepEqual(await f.actions.markArrived('appointment-1', false), { success: true });
  assert.equal(f.state.appointment.arrivedAt, null);
  assert.equal(f.state.appointment.status, 'CONFIRMED');
  assert.deepEqual(f.audits.map((audit) => audit.action), ['APPOINTMENT.ARRIVAL_CLEARED']);
  assert.equal(f.counts.invalidations, 0);

  // Nothing to clear: no write, no audit.
  const none = fixture();
  assert.deepEqual(await none.actions.markArrived('appointment-1', false), { success: true });
  assert.equal(none.counts.writes, 0);
  assert.deepEqual(none.audits, []);
});

test('outside the window or not CONFIRMED is refused', async () => {
  // Too early (opens 60 minutes before), and too late for a 45-minute service (closes at start + 120).
  for (const date of [minutes(120), minutes(61), minutes(-121)]) {
    const f = fixture({ date });
    assert.deepEqual(await f.actions.markArrived('appointment-1', true), { success: false, error: text('ARRIVAL_WINDOW_CLOSED') });
    assert.equal(f.state.appointment.arrivedAt, null);
    assert.equal(f.counts.writes, 0);
    assert.deepEqual(f.audits, []);
  }
  const clearing = fixture({ date: minutes(-121), arrivedAt: minutes(-120) });
  assert.deepEqual(await clearing.actions.markArrived('appointment-1', false), { success: false, error: text('ARRIVAL_WINDOW_CLOSED') });
  assert.deepEqual(clearing.state.appointment.arrivedAt, minutes(-120));

  for (const status of ['PENDING', 'CANCELLED', 'COMPLETED']) {
    const f = fixture({ status });
    assert.deepEqual(await f.actions.markArrived('appointment-1', true), { success: false, error: text('ONLY_CONFIRMED_ARRIVAL') });
    assert.equal(f.state.appointment.arrivedAt, null);
    assert.equal(f.counts.writes, 0);
    assert.deepEqual(f.audits, []);
  }

  const missing = fixture();
  assert.deepEqual(await missing.actions.markArrived('appointment-2', true), { success: false, error: text('APPOINTMENT_NOT_FOUND') });
});

// Final review M2: the rule cancelled it a moment ago — the way back is Restore, not "only a confirmed booking".
test('Arrived on a booking the rule has cancelled points staff to Restore', async () => {
  const f = fixture({ status: 'CANCELLED', lateCancelledAt: minutes(-2), deposit: 'KEPT' });
  assert.deepEqual(await f.actions.markArrived('appointment-1', true), { success: false, error: text('LATE_CANCELLED_USE_RESTORE') });
  assert.equal(text('LATE_CANCELLED_USE_RESTORE'), 'This booking was cancelled by the late-arrival rule. Use Restore in the Arrivals panel.');
  assert.deepEqual([f.state.appointment.status, f.state.appointment.arrivedAt, f.state.attempt?.status], ['CANCELLED', null, 'KEPT']);
  assert.deepEqual([f.counts.writes, f.audits], [0, []]);
});

test('an arrival racing the late-arrival rule is refused once the rule has cancelled the booking', async () => {
  const f = fixture({
    afterRead: (state) => Object.assign(state.appointment, { status: 'CANCELLED', lateCancelledAt: NOW }),
  });
  assert.deepEqual(await f.actions.markArrived('appointment-1', true), { success: false, error: text('STALE') });
  assert.equal(f.state.appointment.status, 'CANCELLED');
  assert.equal(f.state.appointment.arrivedAt, null);
  assert.deepEqual(f.audits, []);
});

test('restore within 24 h: CONFIRMED, arrived, KEPT→CAPTURED, version+1, audit', async () => {
  for (const lateCancelledAt of [minutes(-5), minutes(-24 * 60)]) {
    const f = fixture({ status: 'CANCELLED', lateCancelledAt, deposit: 'KEPT' });
    assert.deepEqual(await f.actions.restoreLateCancellation('appointment-1'), { success: true });
    assert.equal(f.state.appointment.status, 'CONFIRMED');
    assert.equal(f.state.appointment.lateCancelledAt, null);
    assert.deepEqual(f.state.appointment.arrivedAt, NOW, 'arrived, so the rule never cancels it again');
    assert.equal(f.state.appointment.notificationVersion, 2, 'the queued late-cancel email is no longer current');
    assert.equal(f.state.attempt?.status, 'CAPTURED', 'the kept deposit counts towards the bill again');
    assert.deepEqual(f.audits, [{
      action: 'APPOINTMENT.LATE_CANCEL_RESTORED', actorUserId: 'admin-1', targetId: 'appointment-1',
      metadata: { forced: false, deposit: 'CAPTURED' },
    }]);
    assert.equal(f.clashChecks.length, 1);
    assert.equal(f.clashChecks[0].client, f.tx, 'the clash check reads the transaction it writes in');
    assert.deepEqual(f.clashChecks[0].target, {
      appointmentId: 'appointment-1', stylistId: 'stylist-1', start: minutes(-20), durationMin: 45, userId: 'user-1', requiresPatchTest: false,
    });
  }

  const noDeposit = fixture({ status: 'CANCELLED', lateCancelledAt: minutes(-5) });
  noDeposit.state.appointment.durationAtBooking = null;
  assert.deepEqual(await noDeposit.actions.restoreLateCancellation('appointment-1'), { success: true });
  assert.equal(noDeposit.state.appointment.status, 'CONFIRMED');
  assert.equal(noDeposit.clashChecks[0].target.durationMin, 60, 'falls back to the service length');
  assert.deepEqual(noDeposit.audits.map((audit) => audit.metadata), [{ forced: false }]);
});

test('restore refused after 24 h, without lateCancelledAt, or when the deposit is not KEPT', async () => {
  const refused: FixtureOptions[] = [
    { status: 'CANCELLED', lateCancelledAt: minutes(-24 * 60 - 1), deposit: 'KEPT' },
    // Cancelled by staff or the customer, never by the rule.
    { status: 'CANCELLED', lateCancelledAt: null },
    { status: 'CANCELLED', lateCancelledAt: null, deposit: 'KEPT' },
    // The deposit went back or is anything but kept: a refund cannot be undone.
    { status: 'CANCELLED', lateCancelledAt: minutes(-5), deposit: 'CAPTURED' },
    { status: 'CANCELLED', lateCancelledAt: minutes(-5), deposit: 'VOIDED' },
  ];
  for (const options of refused) {
    const f = fixture(options);
    const untouched = structuredClone(f.state);
    assert.deepEqual(await f.actions.restoreLateCancellation('appointment-1', { force: true }), { success: false, error: text('LATE_CANCEL_NOT_RESTORABLE') }, JSON.stringify(options));
    assert.deepEqual(f.state, untouched, 'nothing changes');
    assert.equal(f.counts.writes, 0);
    assert.equal(f.clashChecks.length, 0);
    assert.deepEqual(f.audits, []);
    assert.equal(f.counts.invalidations, 0);
  }
});

// Final review F4: a booking that is no longer CANCELLED is never "create a new booking".
test('restore on a booking that is no longer cancelled: already restored is success, anything else is STALE', async () => {
  // A double tap: the first restore committed before this one read the booking.
  const restored = fixture({ status: 'CONFIRMED', lateCancelledAt: null, arrivedAt: minutes(-1), deposit: 'CAPTURED' });
  const untouched = structuredClone(restored.state);
  assert.deepEqual(await restored.actions.restoreLateCancellation('appointment-1'), { success: true });
  assert.deepEqual(restored.state, untouched, 'nothing changes');
  assert.deepEqual([restored.counts.writes, restored.clashChecks.length, restored.audits, restored.counts.invalidations], [0, 0, [], 0]);

  for (const options of [
    { status: 'CONFIRMED', lateCancelledAt: minutes(-5) },
    { status: 'COMPLETED', lateCancelledAt: null },
    { status: 'PENDING', lateCancelledAt: null },
  ] satisfies FixtureOptions[]) {
    const f = fixture(options);
    const before = structuredClone(f.state);
    assert.deepEqual(await f.actions.restoreLateCancellation('appointment-1', { force: true }), { success: false, error: text('STALE') }, JSON.stringify(options));
    assert.deepEqual(f.state, before);
    assert.deepEqual([f.counts.writes, f.clashChecks.length, f.audits, f.counts.invalidations], [0, 0, [], 0]);
  }
});

test('restore with a clash returns the clashes unless forced', async () => {
  const f = fixture({ status: 'CANCELLED', lateCancelledAt: minutes(-5), deposit: 'KEPT', clashes: [OVERLAP] });
  assert.deepEqual(await f.actions.restoreLateCancellation('appointment-1'), { success: false, clashes: [OVERLAP] });
  assert.equal(f.state.appointment.status, 'CANCELLED');
  assert.equal(f.state.attempt?.status, 'KEPT');
  assert.equal(f.counts.writes, 0);
  assert.equal(f.audits.length, 0);
  assert.equal(f.counts.invalidations, 0);

  assert.deepEqual(await f.actions.restoreLateCancellation('appointment-1', { force: true }), { success: true });
  assert.equal(f.state.appointment.status, 'CONFIRMED');
  assert.equal(f.state.attempt?.status, 'CAPTURED');
  assert.deepEqual(f.audits.map((audit) => [audit.action, audit.metadata]), [['APPOINTMENT.LATE_CANCEL_RESTORED', { forced: true, deposit: 'CAPTURED' }]]);
});

test('a restore that loses a race changes nothing', async () => {
  // The deposit moved off KEPT after the read: the booking is not restored either.
  const deposit = fixture({
    status: 'CANCELLED', lateCancelledAt: minutes(-5), deposit: 'KEPT',
    afterRead: (state) => { if (state.attempt) state.attempt.status = 'VOIDED'; },
  });
  assert.deepEqual(await deposit.actions.restoreLateCancellation('appointment-1'), { success: false, error: text('STALE') });
  assert.equal(deposit.state.appointment.status, 'CANCELLED', 'rolled back with the deposit');
  assert.deepEqual(deposit.state.appointment.lateCancelledAt, minutes(-5));
  assert.equal(deposit.state.appointment.arrivedAt, null);
  assert.equal(deposit.state.appointment.notificationVersion, 1);
  assert.equal(deposit.state.attempt?.status, 'VOIDED');
  assert.deepEqual(deposit.audits, []);
  assert.equal(deposit.counts.invalidations, 0);

  // Another restore (a double tap) committed first: the deposit is not touched again.
  const twice = fixture({
    status: 'CANCELLED', lateCancelledAt: minutes(-5), deposit: 'KEPT',
    afterRead: (state) => {
      Object.assign(state.appointment, { status: 'CONFIRMED', lateCancelledAt: null, arrivedAt: minutes(-1), notificationVersion: 2 });
      if (state.attempt) state.attempt.status = 'CAPTURED';
    },
  });
  assert.deepEqual(await twice.actions.restoreLateCancellation('appointment-1'), { success: false, error: text('STALE') });
  assert.equal(twice.counts.writes, 1, 'refused at the booking write, before the deposit');
  assert.equal(twice.state.appointment.notificationVersion, 2);
  assert.deepEqual(twice.state.appointment.arrivedAt, minutes(-1));
  assert.deepEqual(twice.audits, []);
});

test('the restored booking refreshes the busy feed', async () => {
  const f = fixture({ status: 'CANCELLED', lateCancelledAt: minutes(-5), deposit: 'KEPT' });
  assert.deepEqual(await f.actions.restoreLateCancellation('appointment-1'), { success: true });
  assert.equal(f.counts.invalidations, 1);
});
