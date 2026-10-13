import test from 'node:test';
import assert from 'node:assert/strict';
import { attempt, minutes, NOW, paymentsDb, refund } from '../../test/payments-fixture';
import { alertWindows, collectPaymentAttention, countPaymentAttention, DECLINES_WORTH_A_LOOK, pageWindows } from './payment-attention';
import { OPERATIONS_MESSAGES } from './operations-messages';

// Which card deposits and refunds need a person (phase S4): one rule set for
// the daily email and Admin → Operations.

const date = minutes(3 * 24 * 60);

test('an unanswered authorization is flagged unless reconciliation is already cancelling it — whatever its last error', async () => {
  const store = paymentsDb({
    now: () => NOW,
    attempts: [
      // No last error at all: SQL's `<>` would drop it; it must still be flagged.
      attempt({ id: 'bare', status: 'UNKNOWN', squarePaymentId: null, lastError: null, updatedAt: minutes(-120) }),
      attempt({ id: 'unknown', status: 'UNKNOWN', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_OUTCOME_UNKNOWN, updatedAt: minutes(-120) }),
      attempt({ id: 'cancelling', status: 'UNKNOWN', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_UNKNOWN_CANCELLING, updatedAt: minutes(-120) }),
      attempt({ id: 'crashed', status: 'INITIATED', squarePaymentId: null, updatedAt: minutes(-120) }),
      attempt({ id: 'fresh', status: 'CAPTURE_UNKNOWN', updatedAt: minutes(-10) }),
    ],
  });
  const found = await collectPaymentAttention(store.db as never, NOW, alertWindows(NOW));
  assert.deepEqual(found.attempts.map((row) => [row.id, row.problem]), [['bare', 'AWAITING_SQUARE'], ['crashed', 'AWAITING_SQUARE'], ['unknown', 'AWAITING_SQUARE']].sort());
});

test('money states: taken but unconfirmed, taken on a cancelled booking with no refund, a hold nobody released', async () => {
  const store = paymentsDb({
    now: () => NOW,
    appointments: [
      { id: 'pending', status: 'PENDING', date }, { id: 'cancelled', status: 'CANCELLED', date }, { id: 'refunding', status: 'CANCELLED', date },
      { id: 'completed', status: 'COMPLETED', date }, { id: 'open', status: 'PENDING', date }, { id: 'kept', status: 'CANCELLED', date },
    ],
    attempts: [
      attempt({ id: 'taken', appointmentId: 'pending', status: 'CAPTURED' }),
      attempt({ id: 'unexplained', appointmentId: 'cancelled', status: 'CAPTURED' }),
      attempt({ id: 'refunding', appointmentId: 'refunding', status: 'CAPTURED' }),
      attempt({ id: 'stuck', appointmentId: 'completed', status: 'AUTHORIZED', updatedAt: minutes(-120) }),
      attempt({ id: 'needed', appointmentId: 'open', status: 'AUTHORIZED', updatedAt: minutes(-120) }),
      attempt({ id: 'orphan', status: 'AUTHORIZED', updatedAt: minutes(-120) }),
      // Staff kept it when they cancelled: explained, so not listed.
      attempt({ id: 'kept', appointmentId: 'kept', status: 'KEPT', updatedAt: minutes(-120) }),
    ],
    refunds: [refund({ id: 'r', attemptId: 'refunding', status: 'PENDING' })],
  });
  const found = await collectPaymentAttention(store.db as never, NOW, alertWindows(NOW));
  assert.deepEqual(Object.fromEntries(found.attempts.map((row) => [row.id, row.problem])), {
    taken: 'TAKEN_NOT_CONFIRMED', unexplained: 'TAKEN_ON_CANCELLED', stuck: 'HOLD_NOT_RELEASED', orphan: 'HOLD_NOT_RELEASED',
  });
  assert.equal(found.attempts.find((row) => row.id === 'taken')?.appointmentDate?.getTime(), date.getTime());
});

test('refunds Square has not confirmed include one stuck being sent and one whose retry Square refused (still UNKNOWN)', async () => {
  const store = paymentsDb({
    now: () => NOW,
    attempts: [attempt({ id: 'a', status: 'CAPTURED' })],
    refunds: [
      refund({ id: 'stuck', attemptId: 'a', status: 'SUBMITTING', updatedAt: minutes(-90) }),
      // Being sent right now: its sender records the answer.
      refund({ id: 'sending', attemptId: 'a', status: 'SUBMITTING', updatedAt: minutes(-1) }),
      // Refused on retry: left UNKNOWN, untouched, so it stays listed.
      refund({ id: 'refused-retry', attemptId: 'a', status: 'UNKNOWN', updatedAt: minutes(-25 * 60) }),
    ],
  });
  const email = await collectPaymentAttention(store.db as never, NOW, alertWindows(NOW));
  assert.deepEqual(email.refunds.map((row) => [row.id, row.problem]).sort(), [['refused-retry', 'UNCONFIRMED'], ['stuck', 'UNCONFIRMED']]);
  assert.equal(countPaymentAttention(email).refundsUnconfirmed, 2);
});

// Review W-C: every retry now dates its row (updatedAt = last tried), so how
// long a refund has waited is read from when it was requested — a retry (the
// daily run's, or staff pressing Re-check payment) never hides it for an hour.
test('a refund retried moments ago is still listed, as waiting since it was requested', async () => {
  const store = paymentsDb({
    now: () => NOW,
    attempts: [attempt({ id: 'a', status: 'CAPTURED' }), attempt({ id: 'b', status: 'CAPTURED' })],
    refunds: [
      refund({ id: 'retried', attemptId: 'a', status: 'UNKNOWN', createdAt: minutes(-26 * 60), updatedAt: minutes(-1) }),
      // Requested and sent minutes ago: it may still settle by itself.
      refund({ id: 'fresh', attemptId: 'b', status: 'UNKNOWN', createdAt: minutes(-5), updatedAt: minutes(-5) }),
    ],
  });
  const found = await collectPaymentAttention(store.db as never, NOW, alertWindows(NOW));
  assert.deepEqual(found.refunds.map((row) => [row.id, row.problem, row.since.getTime()]), [['retried', 'UNCONFIRMED', minutes(-26 * 60).getTime()]]);
});

// Review W-C: a refund the daily run stopped retrying needs staff until they
// settle it (whatever its age); one they settled outside the website needs nobody.
test('a refund handed to staff (UNRESOLVED) is listed until it is settled; one settled outside the website is not', async () => {
  const store = paymentsDb({
    now: () => NOW,
    attempts: [attempt({ id: 'a', status: 'CAPTURED' }), attempt({ id: 'b', status: 'CAPTURED' })],
    refunds: [
      refund({ id: 'given-up', attemptId: 'a', status: 'UNRESOLVED', updatedAt: minutes(-40 * 24 * 60) }),
      refund({ id: 'settled', attemptId: 'b', status: 'SETTLED_EXTERNALLY', updatedAt: minutes(-60) }),
    ],
  });
  for (const windows of [alertWindows(NOW), pageWindows(NOW)]) {
    const found = await collectPaymentAttention(store.db as never, NOW, windows);
    assert.deepEqual(found.refunds.map((row) => [row.id, row.problem]), [['given-up', 'UNRESOLVED']]);
    assert.equal(countPaymentAttention(found).refundsUnresolved, 1);
    assert.equal(countPaymentAttention(found).refundsUnconfirmed, 0);
  }
});

test('refund failures and notifications are reported for a week in the email and longer on the page', async () => {
  const day = 24 * 60;
  const store = paymentsDb({
    now: () => NOW,
    attempts: [attempt({ id: 'a', status: 'CAPTURED' })],
    refunds: [
      refund({ id: 'recent-failure', attemptId: 'a', status: 'FAILED', updatedAt: minutes(-2 * day) }),
      refund({ id: 'older-failure', attemptId: 'a', status: 'REJECTED', updatedAt: minutes(-10 * day) }),
      refund({ id: 'unsent', attemptId: 'a', status: 'REQUESTED', updatedAt: minutes(-90) }),
      // Requested and sent five minutes ago: its wait is counted from the request.
      refund({ id: 'just-sent', attemptId: 'a', status: 'UNKNOWN', createdAt: minutes(-5), updatedAt: minutes(-5) }),
      refund({ id: 'late', attemptId: 'a', status: 'COMPLETED', reason: 'LATE_CAPTURE', createdAt: minutes(-3 * day), updatedAt: minutes(-2 * day) }),
    ],
    events: [
      { eventId: 'yesterday', type: 'payment.created', objectId: 'p1', receivedAt: minutes(-20 * 60), processedAt: null },
      { eventId: 'last-week', type: 'payment.created', objectId: 'p2', receivedAt: minutes(-6 * day), processedAt: null },
      { eventId: 'settled', type: 'payment.created', objectId: 'p3', receivedAt: minutes(-60 * 3), processedAt: minutes(-60 * 3) },
    ],
  });
  const email = await collectPaymentAttention(store.db as never, NOW, alertWindows(NOW));
  assert.deepEqual(email.refunds.map((row) => [row.id, row.problem]).sort(), [['recent-failure', 'FAILED'], ['unsent', 'UNCONFIRMED']]);
  assert.deepEqual(email.notifications.map((row) => row.eventId), ['yesterday']);
  assert.deepEqual(countPaymentAttention(email), {
    squareSetupRefused: 0, awaitingSquare: 0, takenNotConfirmed: 0, takenOnCancelled: 0, holdsNotReleased: 0, refundsFailed: 1, refundsUnresolved: 0,
    refundsUnconfirmed: 1, lateCaptures: 0, cardDeclines: 0, unmatchedNotifications: 1,
  });
  const page = await collectPaymentAttention(store.db as never, NOW, pageWindows(NOW));
  assert.deepEqual(page.refunds.map((row) => [row.id, row.problem]).sort(), [['late', 'LATE_CAPTURE'], ['older-failure', 'FAILED'], ['recent-failure', 'FAILED'], ['unsent', 'UNCONFIRMED']]);
  assert.deepEqual(page.notifications.map((row) => row.eventId), ['yesterday', 'last-week']);
});

test('card declines in the last 24 hours are counted; the daily email raises them only when there are more than usual', async () => {
  const declined = (id: string, hoursAgo: number, lastError: string = OPERATIONS_MESSAGES.PAYMENT_DECLINED) =>
    attempt({ id, status: 'FAILED', squarePaymentId: null, lastError, updatedAt: minutes(-hoursAgo * 60) });
  const store = paymentsDb({
    now: () => NOW,
    attempts: [
      declined('d1', 1), declined('d2', 5), declined('d3', 23),
      // A day old: no longer counted.
      declined('old', 25),
      // Never sent (payments switched off): not a decline.
      declined('unsent', 2, OPERATIONS_MESSAGES.PAYMENT_NOT_SENT),
    ],
  });
  const found = await collectPaymentAttention(store.db as never, NOW, alertWindows(NOW));
  assert.equal(found.declines, 3);
  assert.equal(countPaymentAttention(found).cardDeclines, 0, 'a few declines a day are ordinary');
  assert.equal(countPaymentAttention({ ...found, declines: DECLINES_WORTH_A_LOOK }).cardDeclines, DECLINES_WORTH_A_LOOK);
  assert.equal((await collectPaymentAttention(store.db as never, NOW, pageWindows(NOW))).declines, 3);
});

// Review W-A: Square refusing the website's own credentials, permissions or
// location (401/403/404) is a configuration problem — every customer is
// turned away — never a card decline (and never "card testing").
test('Square refusing the website’s setup is counted on its own and always raised, never as card declines', async () => {
  const refused = (id: string, hoursAgo: number) =>
    attempt({ id, status: 'FAILED', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_SETUP_REFUSED, updatedAt: minutes(-hoursAgo * 60) });
  const store = paymentsDb({
    now: () => NOW,
    attempts: [
      refused('r1', 1), refused('r2', 20),
      // Yesterday's: no longer counted.
      refused('old', 30),
      attempt({ id: 'declined', status: 'FAILED', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_DECLINED, updatedAt: minutes(-60) }),
    ],
  });
  const found = await collectPaymentAttention(store.db as never, NOW, alertWindows(NOW));
  assert.deepEqual([found.declines, found.setupRefusals], [1, 2]);
  const counts = countPaymentAttention(found);
  assert.equal(counts.squareSetupRefused, 2, 'one is already too many: nobody can pay a deposit');
  assert.equal(counts.cardDeclines, 0);
  assert.equal(countPaymentAttention({ ...found, setupRefusals: 1 }).squareSetupRefused, 1);
  assert.equal((await collectPaymentAttention(store.db as never, NOW, pageWindows(NOW))).setupRefusals, 2);
});
