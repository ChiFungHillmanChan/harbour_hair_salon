import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attempt, CONFIG, fakeSquare, minutes, NOW, paymentsDb, refund,
  type AppointmentRow, type AttemptRow, type EventRow, type RefundRow,
} from '../../test/payments-fixture';
import { createPaymentReconciliation, HOLD_LIFETIME_MS } from './payment-reconciliation';
import { OPERATIONS_MESSAGES } from './operations-messages';
import { SquareGatewayError } from './square-gateway';
import { createRefundRequest, refundableRemainderPence } from './payment-refunds';
import { alertWindows, collectPaymentAttention, pageWindows } from './payment-attention';
import { approvalStep, planDepositForClosing } from './deposit-lifecycle';

// Reconciliation (phase S4): the daily run, a webhook's follow-up and "Re-check
// payment" — the real service over the in-memory payment tables and a fake
// Square that behaves like Square.

type Seed = { appointments?: AppointmentRow[]; attempts?: AttemptRow[]; refunds?: RefundRow[]; events?: EventRow[] };

function harness(seed: Seed = {}, options: { config?: typeof CONFIG | null; now?: Date; clock?: () => number } = {}) {
  const now = options.now ?? NOW;
  const store = paymentsDb({ ...seed, now: () => now });
  const square = fakeSquare();
  const gatewaysAskedFor: { environment: string; locationId: string }[] = [];
  const reconciliation = createPaymentReconciliation({
    db: store.db as never,
    config: options.config === undefined ? CONFIG : options.config,
    // The guarded path: only this deployment's environment and location get a gateway.
    gatewayFor: (owner) => {
      gatewaysAskedFor.push(owner);
      return owner.environment === CONFIG.environment && owner.locationId === CONFIG.locationId ? square.gateway as never : null;
    },
    now: () => now,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  return { ...store, square, reconciliation, gatewaysAskedFor };
}

const booking = (id: string, status: string): AppointmentRow => ({ id, status, date: minutes(3 * 24 * 60) });
const old = { createdAt: minutes(-2 * 24 * 60), updatedAt: minutes(-60) };

test('with no usable Square configuration the daily run reads and asks nothing', async () => {
  const h = harness({ attempts: [attempt({ id: 'x', status: 'UNKNOWN' })] }, { config: null });
  assert.deepEqual(await h.reconciliation.reconcileAll(), { skipped: true, checked: 0, lateCaptureRefunds: 0, unresolved: 0, failed: 0, outOfTime: false });
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.square.calls.order, []);
});

test('captures nobody saw finish are settled with Square: taken, still held, or dropped', async () => {
  const h = harness({
    appointments: [booking('p1', 'PENDING'), booking('p2', 'PENDING'), booking('p3', 'PENDING'), booking('c1', 'CONFIRMED'), booking('p4', 'PENDING')],
    attempts: [
      attempt({ id: 'taken', appointmentId: 'p1', status: 'CAPTURE_UNKNOWN', ...old }),
      attempt({ id: 'held', appointmentId: 'p2', status: 'CAPTURING', ...old }),
      attempt({ id: 'dropped', appointmentId: 'p3', status: 'CAPTURE_UNKNOWN', ...old }),
      attempt({ id: 'confirmed', appointmentId: 'c1', status: 'CAPTURE_UNKNOWN', ...old }),
      // Claimed 5 minutes ago: younger than the run's waiting period, left alone.
      attempt({ id: 'young', appointmentId: 'p4', status: 'CAPTURING', updatedAt: minutes(-5) }),
    ],
  });
  h.square.hold('pay-taken', 'taken', 'COMPLETED');
  h.square.hold('pay-held', 'held', 'APPROVED');
  h.square.hold('pay-dropped', 'dropped', 'CANCELED');
  h.square.hold('pay-confirmed', 'confirmed', 'COMPLETED');
  h.square.hold('pay-young', 'young', 'APPROVED');
  const summary = await h.reconciliation.reconcileAll();
  // Taken for a request nobody confirmed: recorded and flagged — staff confirm (never taken twice) or decline (refunded).
  assert.deepEqual([h.attempt('taken').status, h.attempt('taken').lastError], ['CAPTURED', OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED]);
  assert.equal(h.refunds('taken').length, 0, 'the money decision stays with staff');
  assert.deepEqual([h.attempt('held').status, h.attempt('held').lastError], ['AUTHORIZED', null]);
  assert.deepEqual([h.attempt('dropped').status, h.attempt('dropped').lastError], ['EXPIRED', OPERATIONS_MESSAGES.PAYMENT_HOLD_CANCELLED]);
  assert.deepEqual([h.attempt('confirmed').status, h.attempt('confirmed').lastError], ['CAPTURED', null]);
  assert.equal(h.attempt('young').status, 'CAPTURING');
  assert.ok(!h.square.calls.getPayment.includes('pay-young'));
  assert.deepEqual(h.tables.appointment.map((row) => row.status), ['PENDING', 'PENDING', 'PENDING', 'CONFIRMED', 'PENDING'], 'bookings never change here');
  assert.equal(h.square.calls.capture.length, 0, 'reconciliation never captures');
  assert.equal(summary.checked, 4);
  assert.equal(summary.failed, 0);
});

test('holds no booking wants are released: never booked, or the request closed (incl. confirmed without capture)', async () => {
  const h = harness({
    appointments: [booking('declined', 'CANCELLED'), booking('done', 'COMPLETED'), booking('odd', 'CONFIRMED'), booking('open', 'PENDING'), booking('gone', 'CANCELLED')],
    attempts: [
      attempt({ id: 'orphan', appointmentId: null, ...old }),
      attempt({ id: 'declined', appointmentId: 'declined', lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED, ...old }),
      attempt({ id: 'done', appointmentId: 'done', ...old }),
      attempt({ id: 'odd', appointmentId: 'odd', ...old }),
      attempt({ id: 'open', appointmentId: 'open', ...old }),
      // Square already dropped it: nothing to cancel, just recorded.
      attempt({ id: 'gone', appointmentId: 'gone', ...old }),
      // Released minutes ago by its own closing (or failing right now): not yet.
      attempt({ id: 'recent', appointmentId: null, createdAt: minutes(-60), updatedAt: minutes(-5) }),
    ],
  });
  for (const id of ['orphan', 'declined', 'done', 'odd', 'open', 'recent']) h.square.hold(`pay-${id}`, id);
  h.square.hold('pay-gone', 'gone', 'CANCELED');
  await h.reconciliation.reconcileAll();
  assert.deepEqual([h.attempt('orphan').status, h.attempt('orphan').lastError], ['VOIDED', OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED]);
  assert.deepEqual([h.attempt('declined').status, h.attempt('declined').lastError], ['VOIDED', null]);
  assert.equal(h.attempt('done').status, 'VOIDED');
  assert.equal(h.attempt('odd').status, 'VOIDED', 'a hold nothing will ever capture is given back');
  assert.equal(h.attempt('open').status, 'AUTHORIZED', 'a hold its request still needs is left alone');
  assert.deepEqual([h.attempt('gone').status, h.attempt('gone').lastError], ['VOIDED', null]);
  assert.equal(h.attempt('recent').status, 'AUTHORIZED');
  assert.deepEqual(h.square.calls.cancel.sort(), ['pay-declined', 'pay-done', 'pay-odd', 'pay-orphan']);
  assert.ok(!h.square.calls.getPayment.includes('pay-open'), 'an open request is not even asked about');
});

test('a release Square refuses or does not answer stays held, flagged, and is retried next run', async (t) => {
  t.mock.method(console, 'error', () => {});
  const h = harness({ appointments: [booking('closed', 'CANCELLED')], attempts: [attempt({ id: 'closed', appointmentId: 'closed', ...old })] });
  h.square.hold('pay-closed', 'closed');
  h.square.script.cancel = async () => { throw new SquareGatewayError('unknown_outcome'); };
  const summary = await h.reconciliation.reconcileAll();
  assert.deepEqual([h.attempt('closed').status, h.attempt('closed').lastError], ['AUTHORIZED', OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED]);
  assert.equal(summary.unresolved, 1);
  // Square unreachable altogether: nothing changes.
  const away = harness({ appointments: [booking('closed', 'CANCELLED')], attempts: [attempt({ id: 'closed', appointmentId: 'closed', ...old })] });
  away.square.script.getPayment = async () => { throw new SquareGatewayError('unknown_outcome'); };
  assert.equal((await away.reconciliation.reconcileAll()).unresolved, 1);
  assert.equal(away.writes('paymentAttempt'), 0);
  assert.deepEqual(away.square.calls.cancel, []);
});

test('Square took a deposit after its booking closed: recorded taken and refunded in full, exactly once', async () => {
  const h = harness({
    appointments: [booking('declined', 'CANCELLED'), booking('open', 'PENDING')],
    attempts: [
      attempt({ id: 'late', appointmentId: 'declined', lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED, ...old }),
      // Never booked at all, yet taken.
      attempt({ id: 'unbooked', appointmentId: null, ...old }),
    ],
  });
  h.square.hold('pay-late', 'late', 'COMPLETED');
  h.square.hold('pay-unbooked', 'unbooked', 'COMPLETED');
  const summary = await h.reconciliation.reconcileAll();
  assert.equal(summary.lateCaptureRefunds, 2);
  for (const id of ['late', 'unbooked']) {
    assert.deepEqual([h.attempt(id).status, h.attempt(id).lastError], ['CAPTURED', OPERATIONS_MESSAGES.PAYMENT_LATE_CAPTURE_REFUNDED]);
    const rows = h.refunds(id);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].reason, rows[0].amountPence, rows[0].requestedById, rows[0].status], ['LATE_CAPTURE', 2000, null, 'PENDING']);
  }
  assert.deepEqual(h.square.calls.refund.map((call) => [call.paymentId, call.amountPence]), [['pay-late', 2000], ['pay-unbooked', 2000]]);
  assert.deepEqual(h.tables.audit.map((row) => [row.action, row.targetId]), [['PAYMENT.LATE_CAPTURE_REFUND', 'late'], ['PAYMENT.LATE_CAPTURE_REFUND', 'unbooked']]);
  assert.equal(h.tables.appointment[0].status, 'CANCELLED');
  // Run again: the deposits are now recorded taken and refunding — nothing more.
  await h.reconciliation.reconcileAll();
  assert.equal(h.tables.paymentRefund.length, 2, 'never a second refund');
  assert.equal(h.square.calls.refund.length, 2);
});

test('a late capture whose refund cannot be written leaves no trace to mislead the next run', async (t) => {
  t.mock.method(console, 'error', () => {});
  const h = harness({ appointments: [booking('declined', 'CANCELLED')], attempts: [attempt({ id: 'late', appointmentId: 'declined', ...old })] });
  h.square.hold('pay-late', 'late', 'COMPLETED');
  h.faults.push({ model: 'paymentRefund', method: 'create', error: new Error('database unavailable'), times: 1 });
  const summary = await h.reconciliation.reconcileAll();
  assert.equal(summary.failed, 1);
  // The whole transaction rolled back: still AUTHORIZED, no refund row, no audit.
  assert.deepEqual([h.attempt('late').status, h.refunds('late').length, h.tables.audit.length], ['AUTHORIZED', 0, 0]);
  await h.reconciliation.reconcileAll();
  assert.equal(h.refunds('late').length, 1, 'the next run refunds it');
});

test('a hold S3 recorded expired by its date alone is confirmed with Square once: released, confirmed or refunded', async () => {
  const h = harness({
    appointments: [booking('a', 'CANCELLED'), booking('b', 'CANCELLED'), booking('c', 'CANCELLED')],
    attempts: [
      // Square has not applied its own expiry yet: released now.
      attempt({ id: 'still-held', appointmentId: 'a', status: 'EXPIRED', lastError: OPERATIONS_MESSAGES.PAYMENT_HOLD_EXPIRED, ...old }),
      attempt({ id: 'gone', appointmentId: 'b', status: 'EXPIRED', lastError: OPERATIONS_MESSAGES.PAYMENT_HOLD_EXPIRED, ...old }),
      // A capture landed after all: the customer was told the hold was released.
      attempt({ id: 'taken', appointmentId: 'c', status: 'EXPIRED', lastError: OPERATIONS_MESSAGES.PAYMENT_HOLD_EXPIRED, ...old }),
    ],
  });
  h.square.hold('pay-still-held', 'still-held', 'APPROVED');
  h.square.hold('pay-gone', 'gone', 'CANCELED');
  h.square.hold('pay-taken', 'taken', 'COMPLETED');
  await h.reconciliation.reconcileAll();
  assert.deepEqual([h.attempt('still-held').status, h.attempt('still-held').lastError, h.square.payments.get('pay-still-held')?.status], ['EXPIRED', null, 'CANCELED']);
  assert.deepEqual([h.attempt('gone').status, h.attempt('gone').lastError], ['EXPIRED', OPERATIONS_MESSAGES.PAYMENT_HOLD_CANCELLED]);
  assert.deepEqual([h.attempt('taken').status, h.refunds('taken').map((row) => row.reason)], ['CAPTURED', ['LATE_CAPTURE']]);
  assert.deepEqual(h.square.calls.cancel, ['pay-still-held']);
  // Confirmed: never asked about again.
  const asked = h.square.calls.getPayment.length;
  await h.reconciliation.reconcileAll();
  assert.equal(h.square.calls.getPayment.length, asked);
});

test('authorizations nobody heard back about are cancelled by key daily for 7 days, then settled', async () => {
  const day = 24 * 60;
  const h = harness({
    attempts: [
      attempt({ id: 'unknown', status: 'UNKNOWN', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_OUTCOME_UNKNOWN, createdAt: minutes(-day), updatedAt: minutes(-day) }),
      attempt({ id: 'crashed', status: 'INITIATED', squarePaymentId: null, createdAt: minutes(-20), updatedAt: minutes(-20) }),
      attempt({ id: 'in-flight', status: 'INITIATED', squarePaymentId: null, createdAt: minutes(-2), updatedAt: minutes(-2) }),
      attempt({ id: 'by-key', status: 'VOIDED', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED, createdAt: minutes(-2 * day), updatedAt: minutes(-2 * day) }),
      attempt({ id: 'by-key-old', status: 'VOIDED', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED, createdAt: minutes(-8 * day), updatedAt: minutes(-8 * day) }),
      attempt({ id: 'expired-unknown', status: 'UNKNOWN', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_OUTCOME_UNKNOWN, createdAt: new Date(NOW.getTime() - HOLD_LIFETIME_MS - 60_000), updatedAt: minutes(-day) }),
      // Its Square id was learnt from a notification: cancelled by id, for certain.
      attempt({ id: 'known', status: 'UNKNOWN', squarePaymentId: 'pay-known', createdAt: minutes(-day), updatedAt: minutes(-day) }),
    ],
  });
  h.square.hold('pay-known', 'known');
  await h.reconciliation.reconcileAll();
  assert.deepEqual(h.square.calls.cancelByKey.sort(), ['dep_by-key', 'dep_crashed', 'dep_unknown']);
  // Asked, not proof: still UNKNOWN, no longer flagged (it is being handled), asked again tomorrow.
  assert.deepEqual([h.attempt('unknown').status, h.attempt('unknown').lastError], ['UNKNOWN', OPERATIONS_MESSAGES.PAYMENT_UNKNOWN_CANCELLING]);
  assert.deepEqual([h.attempt('crashed').status, h.attempt('crashed').lastError], ['UNKNOWN', OPERATIONS_MESSAGES.PAYMENT_UNKNOWN_CANCELLING]);
  assert.equal(h.attempt('in-flight').status, 'INITIATED', 'its own submission is still answering');
  assert.deepEqual([h.attempt('by-key').status, h.attempt('by-key').lastError], ['VOIDED', OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED]);
  assert.deepEqual([h.attempt('expired-unknown').status, h.attempt('expired-unknown').lastError], ['VOIDED', OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED]);
  assert.deepEqual([h.attempt('known').status, h.attempt('known').lastError], ['VOIDED', OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED]);
  assert.deepEqual(h.square.calls.cancel, ['pay-known']);
  // The next day: asked again, still no write needed.
  const writes = h.writes('paymentAttempt');
  await h.reconciliation.reconcileAll();
  assert.equal(h.square.calls.cancelByKey.filter((key) => key === 'dep_unknown').length, 2);
  assert.equal(h.writes('paymentAttempt'), writes);
});

test('refunds Square has not answered are asked again with the same key; accepted ones are followed to the end', async () => {
  const h = harness({
    appointments: [booking('a', 'CANCELLED'), booking('b', 'CANCELLED'), booking('c', 'CANCELLED'), booking('d', 'CANCELLED')],
    attempts: ['a', 'b', 'c', 'd'].map((id) => attempt({ id, appointmentId: id, status: 'CAPTURED' })),
    refunds: [
      refund({ id: 'never-sent', attemptId: 'a', status: 'REQUESTED', updatedAt: minutes(-30) }),
      // Sent; the answer was lost. Square already has it under this key.
      refund({ id: 'lost-answer', attemptId: 'b', status: 'UNKNOWN', idempotencyKey: 'rfd_lost', updatedAt: minutes(-30) }),
      refund({ id: 'pending', attemptId: 'c', status: 'PENDING', squareRefundId: 'sq-refund-rfd_pending', idempotencyKey: 'rfd_pending', updatedAt: minutes(-120) }),
      refund({ id: 'just-sent', attemptId: 'd', status: 'PENDING', squareRefundId: 'sq-refund-rfd_fresh', idempotencyKey: 'rfd_fresh', updatedAt: minutes(-10) }),
    ],
  });
  h.square.knownRefund('rfd_lost', 'pay-b', 'COMPLETED');
  h.square.knownRefund('rfd_pending', 'pay-c', 'COMPLETED');
  h.square.knownRefund('rfd_fresh', 'pay-d', 'COMPLETED');
  await h.reconciliation.reconcileAll();
  const byId = (id: string) => h.tables.paymentRefund.find((row) => row.id === id)!;
  assert.deepEqual([byId('never-sent').status, byId('never-sent').squareRefundId], ['PENDING', 'sq-refund-rfd_never-sent']);
  assert.deepEqual([byId('lost-answer').status, byId('lost-answer').squareRefundId], ['COMPLETED', 'sq-refund-rfd_lost'], 'the same key returns the original refund');
  assert.equal(byId('pending').status, 'COMPLETED');
  assert.equal(byId('just-sent').status, 'PENDING', 'followed only once it is an hour old');
  assert.deepEqual(h.square.calls.refund.map((call) => call.idempotencyKey).sort(), ['rfd_lost', 'rfd_never-sent']);
  assert.deepEqual(h.square.calls.getRefund, ['sq-refund-rfd_pending']);
});

// Money-safety review W1: a refund whose first send may have reached Square is
// retried with its own key, and a refusal then never makes it FAILED (which
// would make the deposit refundable a second time).
test('a refund stuck SUBMITTING is retried like UNKNOWN; a retry Square refuses stays UNKNOWN — never FAILED', async (t) => {
  t.mock.method(console, 'error', () => {});
  const h = harness({
    appointments: [booking('a', 'CANCELLED'), booking('b', 'CANCELLED'), booking('c', 'CANCELLED')],
    attempts: ['a', 'b', 'c'].map((id) => attempt({ id, appointmentId: id, status: 'CAPTURED' })),
    refunds: [
      // Its sender died after asking Square, which made the refund.
      refund({ id: 'landed', attemptId: 'a', status: 'SUBMITTING', idempotencyKey: 'rfd_landed', updatedAt: minutes(-30) }),
      // Its sender died; Square refuses the retry (an access token rotated since, say).
      refund({ id: 'refused', attemptId: 'b', status: 'SUBMITTING', idempotencyKey: 'rfd_refused', updatedAt: minutes(-30) }),
      // Sent earlier with no usable answer; the retry is refused too.
      refund({ id: 'unknown', attemptId: 'c', status: 'UNKNOWN', idempotencyKey: 'rfd_unknown', updatedAt: minutes(-30) }),
    ],
  });
  h.square.knownRefund('rfd_landed', 'pay-a', 'COMPLETED');
  h.square.script.refund = async (real, input) => {
    if (input.idempotencyKey === 'rfd_landed') return real();
    throw new SquareGatewayError('provider_error', 401);
  };
  const summary = await h.reconciliation.reconcileAll();
  const byId = (id: string) => h.tables.paymentRefund.find((row) => row.id === id)!;
  assert.deepEqual([byId('landed').status, byId('landed').squareRefundId], ['COMPLETED', 'sq-refund-rfd_landed']);
  assert.equal(byId('refused').status, 'UNKNOWN');
  assert.equal(byId('unknown').status, 'UNKNOWN');
  assert.deepEqual(h.square.calls.refund.map((call) => call.idempotencyKey).sort(), ['rfd_landed', 'rfd_refused', 'rfd_unknown'], 'each asked again with its own key');
  assert.equal(summary.unresolved, 2, 'still unconfirmed: listed for staff');
  assert.equal(h.tables.paymentRefund.filter((row) => row.status === 'FAILED').length, 0);
});

// Review W-C (a): a retry Square refuses used to leave its row untouched, and
// the daily batch takes the 20 least recently updated — so 20 such refunds
// would be retried every day forever while every other one waited behind
// them. Each try now touches the row, and the batch goes by last try.
test('refunds Square keeps refusing rotate through the daily batch: every one is asked, oldest-tried first', async (t) => {
  t.mock.method(console, 'error', () => {});
  const ids = Array.from({ length: 25 }, (_, n) => `r${String(n).padStart(2, '0')}`);
  let now = NOW;
  const store = paymentsDb({
    now: () => now,
    appointments: ids.map((id) => booking(id, 'CANCELLED')),
    attempts: ids.map((id) => attempt({ id, appointmentId: id, status: 'CAPTURED' })),
    // Older rows first; all past the run's 15-minute wait and inside the retry window.
    refunds: ids.map((id, n) => refund({ id, attemptId: id, status: 'UNKNOWN', createdAt: minutes(-2 * 24 * 60), updatedAt: minutes(-200 + n) })),
  });
  const square = fakeSquare();
  square.script.refund = async () => { throw new SquareGatewayError('provider_error', 401); };
  const reconciliation = createPaymentReconciliation({ db: store.db as never, config: CONFIG, gatewayFor: () => square.gateway as never, now: () => now });
  await reconciliation.reconcileAll();
  const first = square.calls.refund.map((call) => call.idempotencyKey);
  assert.deepEqual(first, ids.slice(0, 20).map((id) => `rfd_${id}`), 'the 20 least recently tried');
  assert.ok(store.tables.paymentRefund.slice(0, 20).every((row) => row.updatedAt.getTime() === NOW.getTime()), 'each try is recorded on its row');
  now = new Date(NOW.getTime() + 24 * 60 * 60_000);
  await reconciliation.reconcileAll();
  const second = square.calls.refund.slice(20).map((call) => call.idempotencyKey);
  assert.deepEqual(second.slice(0, 5), ids.slice(20).map((id) => `rfd_${id}`), 'the next day starts with the ones not tried yet');
  assert.deepEqual(new Set([...first, ...second]).size, 25, 'nothing waits forever behind the refusals');
  assert.ok(store.tables.paymentRefund.every((row) => row.status === 'UNKNOWN'), 'a refused retry is never FAILED');
});

// Review W-C (b): a retry Square refuses could stay UNKNOWN forever. Automatic
// retries now stop 7 days after the refund was first sent: UNRESOLVED, still
// counted against the deposit (it can never be refunded twice automatically),
// listed for staff — and never sent again by the daily run or Re-check.
test('a refund Square has not confirmed 7 days on is handed to staff (UNRESOLVED): never retried again, still counted, still listed', async (t) => {
  t.mock.method(console, 'error', () => {});
  const day = 24 * 60;
  const ids = ['old-unknown', 'old-stuck', 'old-unsent', 'young'];
  const h = harness({
    appointments: ids.map((id) => booking(id, 'CANCELLED')),
    attempts: ids.map((id) => attempt({ id, appointmentId: id, status: 'CAPTURED' })),
    refunds: [
      refund({ id: 'old-unknown', attemptId: 'old-unknown', status: 'UNKNOWN', createdAt: minutes(-7 * day - 1), updatedAt: minutes(-60) }),
      // Its sender died 8 days ago and nothing has answered since.
      refund({ id: 'old-stuck', attemptId: 'old-stuck', status: 'SUBMITTING', createdAt: minutes(-8 * day), updatedAt: minutes(-8 * day) }),
      // Never sent (payments were switched off): always safe to send, never given up on.
      refund({ id: 'old-unsent', attemptId: 'old-unsent', status: 'REQUESTED', createdAt: minutes(-9 * day), updatedAt: minutes(-9 * day) }),
      refund({ id: 'young', attemptId: 'young', status: 'UNKNOWN', createdAt: minutes(-6 * day), updatedAt: minutes(-60) }),
    ],
  });
  const summary = await h.reconciliation.reconcileAll();
  const status = (id: string) => h.tables.paymentRefund.find((row) => row.id === id)!.status;
  assert.deepEqual(ids.map(status), ['UNRESOLVED', 'UNRESOLVED', 'PENDING', 'PENDING']);
  assert.deepEqual(h.square.calls.refund.map((call) => call.idempotencyKey).sort(), ['rfd_old-unsent', 'rfd_young'], 'the given-up ones are not even asked');
  assert.equal(summary.unresolved, 2, 'still needs a person');
  for (const id of ['old-unknown', 'old-stuck']) {
    assert.equal(await refundableRemainderPence(h.db as never, id), 0, `${id}: never refundable twice`);
    await assert.rejects(createRefundRequest(h.db as never, { id }, 1, 'STAFF_CANCELLED', null), /cannot exceed/);
  }
  // The next runs, and Re-check payment, never send it again.
  const asked = h.square.calls.refund.length;
  await h.reconciliation.reconcileAll();
  const rechecked = await h.reconciliation.recheckAppointment('old-unknown');
  assert.deepEqual(rechecked.kind === 'CHECKED' && [rechecked.after.refunds, rechecked.refunds], [['UNRESOLVED'], [{ status: 'UNRESOLVED', amountPence: 2000 }]]);
  assert.equal(h.square.calls.refund.length, asked);
  // Listed for staff in the daily email and on Operations until they settle it.
  for (const windows of [alertWindows(NOW), pageWindows(NOW)]) {
    const attention = await collectPaymentAttention(h.db as never, NOW, windows);
    assert.deepEqual(attention.refunds.filter((row) => row.problem === 'UNRESOLVED').map((row) => row.id).sort(), ['old-stuck', 'old-unknown']);
  }
});

test('Re-check payment retries a refund stuck SUBMITTING at once, and leaves one being sent right now to its sender', async () => {
  const h = harness({
    appointments: [booking('a', 'CANCELLED'), booking('b', 'CANCELLED')],
    attempts: [attempt({ id: 'a', appointmentId: 'a', status: 'CAPTURED' }), attempt({ id: 'b', appointmentId: 'b', status: 'CAPTURED' })],
    refunds: [
      refund({ id: 'stuck', attemptId: 'a', status: 'SUBMITTING', idempotencyKey: 'rfd_stuck', updatedAt: minutes(-3) }),
      refund({ id: 'sending', attemptId: 'b', status: 'SUBMITTING', idempotencyKey: 'rfd_sending', updatedAt: minutes(-1) }),
    ],
  });
  h.square.knownRefund('rfd_stuck', 'pay-a', 'PENDING');
  const stuck = await h.reconciliation.recheckAppointment('a');
  assert.deepEqual(stuck.kind === 'CHECKED' && [stuck.before.refunds, stuck.after.refunds, stuck.reached], [['SUBMITTING'], ['PENDING'], true]);
  const sending = await h.reconciliation.recheckAppointment('b');
  assert.deepEqual(sending.kind === 'CHECKED' && [sending.after.refunds, sending.reached], [['SUBMITTING'], false]);
  assert.deepEqual(h.square.calls.refund.map((call) => call.idempotencyKey), ['rfd_stuck']);
});

// Money-safety review I1: staff keeping a deposit is recorded (KEPT), so
// nothing reads it as a capture nobody explained and refunds it.
test('a deposit staff kept is never refunded as a late capture: not by Re-check payment, not by a Square notice', async () => {
  const h = harness({
    appointments: [booking('kept', 'CANCELLED'), booking('unexplained', 'CANCELLED')],
    attempts: [
      attempt({ id: 'kept', appointmentId: 'kept', status: 'KEPT', capturedAt: minutes(-120), ...old }),
      // Taken on a cancelled booking with no refund and no keep recorded: told to staff as such.
      attempt({ id: 'unexplained', appointmentId: 'unexplained', status: 'CAPTURED', capturedAt: minutes(-120), ...old }),
    ],
    events: [{ eventId: 'e-kept', type: 'payment.updated', objectId: 'pay-kept', receivedAt: minutes(-60), processedAt: null }],
  });
  h.square.hold('pay-kept', 'kept', 'COMPLETED');
  h.square.hold('pay-unexplained', 'unexplained', 'COMPLETED');
  const kept = await h.reconciliation.recheckAppointment('kept');
  assert.deepEqual(kept.kind === 'CHECKED' && [kept.state, kept.after.status, kept.refunds], ['KEPT', 'KEPT', []]);
  const unexplained = await h.reconciliation.recheckAppointment('unexplained');
  assert.deepEqual(unexplained.kind === 'CHECKED' && [unexplained.state, unexplained.refunds], ['TAKEN_ON_CANCELLED', []]);
  await h.reconciliation.reconcileAll();
  assert.ok(h.event('e-kept')?.processedAt, 'settled: nothing is owed');
  assert.deepEqual([h.attempt('kept').status, h.refunds('kept'), h.square.calls.refund], ['KEPT', [], []]);
});

// Review I-D: Square shows COMPLETED for a deposit this site still records as
// a hold, on a request still open. It used to be only reported: the attempt
// stayed AUTHORIZED, so a decline "released" it (telling the customer nothing
// was taken) and the money came back only days later as a late capture. It is
// now recorded taken — as settle() records a capture nobody saw finish — so a
// decline refunds it at once, with the refund email, and staff see it listed.
test('Square took a deposit this site still records as a hold on an open request: recorded taken and flagged; a decline then refunds it at once, confirming still works', async () => {
  const h = harness({ appointments: [booking('open', 'PENDING')], attempts: [attempt({ id: 'open', appointmentId: 'open', ...old })] });
  h.square.hold('pay-open', 'open', 'COMPLETED');
  const checked = await h.reconciliation.recheckAppointment('open');
  assert.deepEqual(checked.kind === 'CHECKED' && [checked.state, checked.before.status, checked.after.status], ['TAKEN_NOT_CONFIRMED', 'AUTHORIZED', 'CAPTURED']);
  assert.deepEqual([h.attempt('open').status, h.attempt('open').lastError, h.attempt('open').capturedAt], ['CAPTURED', OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED, NOW]);
  assert.deepEqual([h.refunds('open'), h.square.calls.refund, h.square.calls.capture, h.tables.appointment[0].status], [[], [], [], 'PENDING'], 'the money decision stays with staff; the booking never changes here');
  // Listed for staff: taken, request not confirmed.
  const attention = await collectPaymentAttention(h.db as never, NOW, pageWindows(NOW));
  assert.deepEqual(attention.attempts.map((row) => [row.id, row.problem]), [['open', 'TAKEN_NOT_CONFIRMED']]);
  // Confirming finishes without asking Square to take it again …
  assert.equal(approvalStep({ status: h.attempt('open').status, delayedUntil: h.attempt('open').delayedUntil, updatedAt: h.attempt('open').updatedAt }, NOW), 'CONFIRM');
  // … and declining refunds it in full straight away (the refund email says so).
  const plan = await planDepositForClosing(h.db as never, 'open', { closing: 'CANCEL', refund: true, reason: 'STAFF_CANCELLED', requestedById: 'admin-1', now: NOW });
  assert.deepEqual([plan.outcome, plan.amountPence, plan.releaseAttemptId, h.refunds('open').map((row) => [row.reason, row.amountPence])], ['REFUNDING', 2000, null, [['STAFF_CANCELLED', 2000]]]);
});

test('a Square notice that a held deposit was taken, for an open request, is recorded taken after a fresh read — the event settled', async () => {
  const h = harness({
    appointments: [booking('open', 'PENDING')],
    attempts: [attempt({ id: 'open', appointmentId: 'open', ...old })],
    events: [{ eventId: 'e-taken', type: 'payment.updated', objectId: 'pay-open', receivedAt: minutes(-60), processedAt: null }],
  });
  h.square.hold('pay-open', 'open', 'COMPLETED');
  await h.reconciliation.reconcileAll();
  assert.deepEqual([h.attempt('open').status, h.attempt('open').lastError], ['CAPTURED', OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED]);
  assert.ok(h.event('e-taken')?.processedAt, 'nothing more is owed for the notice');
  // A deposit the site had already let go, on a request still open, is still left to a person.
  const released = harness({
    appointments: [booking('open', 'PENDING')],
    attempts: [attempt({ id: 'gone', appointmentId: 'open', status: 'VOIDED', ...old })],
    events: [{ eventId: 'e-gone', type: 'payment.updated', objectId: 'pay-gone', receivedAt: minutes(-60), processedAt: null }],
  });
  released.square.hold('pay-gone', 'gone', 'COMPLETED');
  await released.reconciliation.reconcileAll();
  assert.equal(released.attempt('gone').status, 'VOIDED');
  assert.equal(released.event('e-gone')?.processedAt, null);
});

test('a deposit of another Square environment or location is never asked about', async () => {
  const h = harness({
    appointments: [booking('x', 'CANCELLED')],
    attempts: [
      attempt({ id: 'prod', appointmentId: 'x', environment: 'production', ...old }),
      attempt({ id: 'elsewhere', environment: 'sandbox', locationId: 'another-location', status: 'UNKNOWN', squarePaymentId: null, ...old }),
    ],
    refunds: [refund({ id: 'r', attemptId: 'prod', status: 'UNKNOWN', updatedAt: minutes(-60) })],
  });
  const summary = await h.reconciliation.reconcileAll();
  assert.equal(summary.checked, 0);
  assert.deepEqual(h.square.calls.order, []);
  assert.equal(h.writes('paymentAttempt') + h.writes('paymentRefund'), 0);
});

test('one failing row never stops the others, and the run stops starting checks when its time is up', async (t) => {
  t.mock.method(console, 'error', () => {});
  const h = harness({
    appointments: [booking('a', 'CANCELLED'), booking('b', 'CANCELLED')],
    attempts: [attempt({ id: 'a', appointmentId: 'a', ...old, updatedAt: minutes(-90) }), attempt({ id: 'b', appointmentId: 'b', ...old })],
  });
  // Square let A go; recording that fails (the database dropped out for a moment).
  h.square.hold('pay-a', 'a', 'CANCELED');
  h.square.hold('pay-b', 'b');
  h.faults.push({ model: 'paymentAttempt', method: 'updateMany', error: new Error('database unavailable'), times: 1 });
  const summary = await h.reconciliation.reconcileAll();
  assert.equal(summary.failed, 1);
  assert.equal(h.attempt('a').status, 'AUTHORIZED', 'retried next run');
  assert.equal(h.attempt('b').status, 'VOIDED');

  let elapsed = 0;
  const slow = harness({
    appointments: [booking('a', 'CANCELLED'), booking('b', 'CANCELLED')],
    attempts: [attempt({ id: 'a', appointmentId: 'a', ...old, updatedAt: minutes(-90) }), attempt({ id: 'b', appointmentId: 'b', ...old })],
  }, { clock: () => elapsed });
  slow.square.hold('pay-a', 'a');
  slow.square.hold('pay-b', 'b');
  slow.square.script.getPayment = async (real) => { elapsed += 30_000; return real(); };
  const timed = await slow.reconciliation.reconcileAll();
  assert.equal(timed.outOfTime, true);
  assert.deepEqual([slow.attempt('a').status, slow.attempt('b').status], ['VOIDED', 'AUTHORIZED'], 'the rest waits for the next run');
});

test('open notifications: a fresh read settles them; one about nothing of ours stays listed', async () => {
  const h = harness({
    appointments: [booking('closed', 'CANCELLED')],
    attempts: [attempt({ id: 'voided', appointmentId: 'closed', status: 'VOIDED', ...old }), attempt({ id: 'r-owner', appointmentId: null, status: 'CAPTURED', ...old })],
    refunds: [refund({ id: 'known-refund', attemptId: 'r-owner', status: 'PENDING', squareRefundId: 'sq-known' })],
    events: [
      // Square took a deposit this site had released (rule: refunded in full).
      { eventId: 'e-late', type: 'payment.updated', objectId: 'pay-voided', receivedAt: minutes(-60), processedAt: null },
      { eventId: 'e-stranger', type: 'payment.created', objectId: 'pay-stranger', receivedAt: minutes(-60), processedAt: null },
      { eventId: 'e-refund', type: 'refund.updated', objectId: 'sq-known', receivedAt: minutes(-60), processedAt: null },
      { eventId: 'e-new', type: 'payment.updated', objectId: 'pay-voided', receivedAt: minutes(-2), processedAt: null },
    ],
  });
  h.square.hold('pay-voided', 'voided', 'COMPLETED');
  h.square.hold('pay-stranger', 'not-ours', 'APPROVED');
  await h.reconciliation.reconcileAll();
  assert.ok(h.event('e-late')?.processedAt);
  assert.deepEqual([h.attempt('voided').status, h.refunds('voided').map((row) => row.reason)], ['CAPTURED', ['LATE_CAPTURE']]);
  assert.equal(h.event('e-stranger')?.processedAt, null, 'matches no deposit: stays listed for staff');
  assert.ok(h.event('e-refund')?.processedAt, 'its refund now knows the Square id');
  assert.equal(h.event('e-new')?.processedAt, null, 'too young for the daily run');
});

test('Re-check payment: one booking, at once, then what is true now', async () => {
  const h = harness({
    appointments: [booking('open', 'PENDING'), booking('declined', 'CANCELLED'), booking('paid', 'CANCELLED'), booking('none', 'CONFIRMED'), booking('prod', 'PENDING')],
    attempts: [
      attempt({ id: 'open', appointmentId: 'open' }),
      // Declined a minute ago; its release failed. No waiting period for staff.
      attempt({ id: 'declined', appointmentId: 'declined', updatedAt: minutes(-1), lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED }),
      attempt({ id: 'paid', appointmentId: 'paid', status: 'CAPTURED' }),
      attempt({ id: 'prod', appointmentId: 'prod', environment: 'production' }),
    ],
    refunds: [refund({ id: 'r', attemptId: 'paid', status: 'UNKNOWN', updatedAt: minutes(-1) })],
  });
  h.square.hold('pay-open', 'open');
  h.square.hold('pay-declined', 'declined');
  h.square.knownRefund('rfd_r', 'pay-paid', 'PENDING');

  assert.deepEqual(await h.reconciliation.recheckAppointment('none'), { kind: 'NONE' });
  assert.deepEqual(await h.reconciliation.recheckAppointment('prod'), { kind: 'UNAVAILABLE', status: 'AUTHORIZED' });

  const open = await h.reconciliation.recheckAppointment('open');
  assert.equal(open.kind === 'CHECKED' && open.state, 'HELD');

  const declined = await h.reconciliation.recheckAppointment('declined');
  assert.deepEqual(declined.kind === 'CHECKED' && [declined.state, declined.before.status, declined.after.status, declined.reached], ['RELEASED', 'AUTHORIZED', 'VOIDED', true]);

  const paid = await h.reconciliation.recheckAppointment('paid');
  assert.deepEqual(paid.kind === 'CHECKED' && [paid.state, paid.refunds, paid.before.refunds, paid.after.refunds], ['PAID', [{ status: 'PENDING', amountPence: 2000 }], ['UNKNOWN'], ['PENDING']]);
  assert.deepEqual(h.square.calls.refund.map((call) => call.idempotencyKey), ['rfd_r'], 'asked again with its own key');

  // Square let it go: it can no longer be confirmed (the lapse step closes it).
  h.square.payments.get('pay-open')!.status = 'CANCELED';
  const ended = await h.reconciliation.recheckAppointment('open');
  assert.deepEqual(ended.kind === 'CHECKED' && [ended.state, ended.after.status], ['HOLD_ENDED', 'EXPIRED']);

  // Square unreachable: said so, nothing changed.
  const later = harness({ appointments: [booking('open', 'PENDING')], attempts: [attempt({ id: 'open', appointmentId: 'open' })] });
  later.square.script.getPayment = async () => { throw new SquareGatewayError('unknown_outcome'); };
  const unreachable = await later.reconciliation.recheckAppointment('open');
  assert.deepEqual(unreachable.kind === 'CHECKED' && [unreachable.reached, unreachable.state], [false, 'HELD']);
});
