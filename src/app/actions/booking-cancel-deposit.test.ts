import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { depositFixture, minutes, NOW } from '../../test/deposit-fixture';
import { SquareGatewayError } from '../services/square-gateway';
import { bookingErrorText } from '../services/booking-errors';

/**
 * A customer cancelling a booking that holds a card deposit, or withdrawing a
 * request (phase S3 of docs/superpowers/specs/2026-10-13-square-deposits-design.md),
 * through the real cancelAppointment over the stateful deposit fixture: a
 * withdrawn request's hold is released; a confirmed booking cancelled online
 * (24 hours or more ahead) is refunded in full.
 */

before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

const CAPTURED_DEPOSIT = { status: 'CAPTURED', capturedAt: minutes(-60) };

test('a customer cancelling a confirmed booking online gets the whole deposit back', async () => {
  const f = depositFixture({ status: 'CONFIRMED', deposit: CAPTURED_DEPOSIT });
  assert.deepEqual(await f.customer.cancelAppointment(f.booking.id), { success: true });
  assert.equal(f.booking.status, 'CANCELLED');
  const [refund] = f.refunds;
  assert.deepEqual([f.refunds.length, refund.amountPence, refund.reason, refund.requestedById, refund.status], [1, 2000, 'CUSTOMER_CANCELLED', null, 'PENDING']);
  assert.deepEqual(f.squareCalls.refund, [{ paymentId: 'square-payment-1', amountPence: 2000, idempotencyKey: refund.idempotencyKey }], 'no free text: a retry is always the same request');
  assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.options, notice.deposit]), [
    ['CANCELLATION', { wasConfirmed: true, depositOutcome: 'REFUNDING' }, { amountPence: 2000, status: 'CAPTURED' }],
  ]);
  const english = f.render('CANCELLATION', 'en-GB');
  assert.deepEqual(english.details.at(-1), { label: 'Deposit', value: '£20.00 — being refunded' });
  assert.equal(english.footnotes[0], 'Your £20.00 deposit is being refunded. Most banks show refunds within 5–10 working days; some take up to 14.');
  const chinese = f.render('CANCELLATION', 'zh-HK');
  assert.deepEqual(chinese.details.at(-1), { label: '訂金', value: '£20.00——正在退款' });
  assert.equal(chinese.footnotes[0], '你的 £20.00 訂金正在退還。大部分銀行會於 5 至 10 個工作天內顯示退款，部分銀行或需長達 14 個工作天。');
  assert.equal(f.counts.invalidations, 1);
  assert.equal(f.counts.dispatches, 1);
});

test('a customer withdrawing a request has the hold on their card released', async () => {
  const f = depositFixture();
  assert.deepEqual(await f.customer.cancelAppointment(f.booking.id), { success: true });
  assert.equal(f.booking.status, 'CANCELLED');
  assert.deepEqual(f.squareCalls.cancel, [{ paymentId: 'square-payment-1', amountPence: 2000, referenceId: 'attempt-1' }]);
  assert.equal(f.attempts[0].status, 'VOIDED');
  assert.deepEqual(f.refunds, []);
  assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.options]), [['CANCELLATION', { wasConfirmed: false, depositOutcome: 'RELEASED' }]]);
});

test('a withdrawn request whose hold already ran out is recorded EXPIRED without asking Square', async () => {
  const f = depositFixture({ deposit: { delayedUntil: minutes(-1) } });
  assert.deepEqual(await f.customer.cancelAppointment(f.booking.id), { success: true });
  assert.equal(f.attempts[0].status, 'EXPIRED');
  assert.deepEqual(f.squareCalls.order, []);
  assert.equal(f.queued()[0].options.depositOutcome, 'RELEASED', 'nothing was taken: the customer is told so');
});

test('the 24-hour rule is unchanged: a confirmed booking under 24 hours away is not cancelled and nothing is refunded', async () => {
  const f = depositFixture({ status: 'CONFIRMED', date: minutes(23 * 60), deposit: CAPTURED_DEPOSIT });
  const answer = await f.customer.cancelAppointment(f.booking.id);
  assert.equal(answer.success, false);
  assert.equal(!answer.success && answer.error, bookingErrorText('en-GB', 'CANCEL_TOO_LATE'));
  assert.deepEqual([f.booking.status, f.refunds, f.squareCalls.order], ['CONFIRMED', [], []]);
});

test('while staff are taking the deposit the customer is asked to try again shortly', async () => {
  const f = depositFixture({ deposit: { status: 'CAPTURING', updatedAt: NOW } });
  assert.deepEqual(await f.customer.cancelAppointment(f.booking.id), { success: false, error: bookingErrorText('en-GB', 'DEPOSIT_IN_PROGRESS') });
  assert.deepEqual([f.booking.status, f.attempts[0].status, f.squareCalls.order], ['PENDING', 'CAPTURING', []]);
});

test('an unanswered capture is settled with Square first: taken means refunded in full, held means released', async () => {
  const taken = depositFixture({ deposit: { status: 'CAPTURE_UNKNOWN' }, squareStatus: 'COMPLETED' });
  assert.deepEqual(await taken.customer.cancelAppointment(taken.booking.id), { success: true });
  assert.deepEqual(taken.squareCalls.order, ['getPayment', 'refund']);
  assert.deepEqual(taken.refunds.map((refund) => [refund.amountPence, refund.reason]), [[2000, 'CUSTOMER_CANCELLED']]);
  assert.equal(taken.queued()[0].options.depositOutcome, 'REFUNDING');

  const held = depositFixture({ deposit: { status: 'CAPTURE_UNKNOWN' } });
  assert.deepEqual(await held.customer.cancelAppointment(held.booking.id), { success: true });
  assert.deepEqual(held.squareCalls.order, ['getPayment', 'cancel']);
  assert.equal(held.attempts[0].status, 'VOIDED');

  // Square cannot say yet: nothing changes, the customer is asked to try again.
  const unknown = depositFixture({ deposit: { status: 'CAPTURE_UNKNOWN' }, square: { getPayment: async () => { throw new SquareGatewayError('unknown_outcome'); } } });
  assert.deepEqual(await unknown.customer.cancelAppointment(unknown.booking.id), { success: false, error: bookingErrorText('en-GB', 'DEPOSIT_IN_PROGRESS') });
  assert.deepEqual([unknown.booking.status, unknown.attempts[0].status], ['PENDING', 'CAPTURE_UNKNOWN']);
});

test('a capture that went unanswered moments ago: the customer is asked to try again shortly, and Square is not asked yet', async () => {
  const f = depositFixture({ deposit: { status: 'CAPTURE_UNKNOWN', updatedAt: minutes(-1) } });
  assert.deepEqual(await f.customer.cancelAppointment(f.booking.id), { success: false, error: bookingErrorText('en-GB', 'DEPOSIT_IN_PROGRESS') });
  assert.deepEqual([f.booking.status, f.attempts[0].status, f.squareCalls.order], ['PENDING', 'CAPTURE_UNKNOWN', []]);
});

test('Square refusing the refund records it FAILED; the cancellation stands', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = depositFixture({ status: 'CONFIRMED', deposit: CAPTURED_DEPOSIT, square: { refund: async () => { throw new SquareGatewayError('provider_error', 400); } } });
  assert.deepEqual(await f.customer.cancelAppointment(f.booking.id), { success: true });
  assert.equal(f.booking.status, 'CANCELLED');
  assert.equal(f.refunds[0].status, 'FAILED');
});

test('only the booking’s own customer can cancel it: nothing moves for anyone else', async () => {
  const f = depositFixture({ status: 'CONFIRMED', deposit: CAPTURED_DEPOSIT, customerId: 'someone-else' });
  const answer = await f.customer.cancelAppointment(f.booking.id);
  assert.equal(answer.success, false);
  assert.deepEqual([f.booking.status, f.refunds, f.squareCalls.order], ['CONFIRMED', [], []]);
});

test('a booking without a deposit is cancelled as before, in the customer’s language', async () => {
  const f = depositFixture({ status: 'CONFIRMED', deposit: null, locale: 'zh-HK' });
  assert.deepEqual(await f.customer.cancelAppointment(f.booking.id), { success: true });
  assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.options, notice.deposit]), [['CANCELLATION', { wasConfirmed: true }, null]]);
  assert.deepEqual(f.squareCalls.order, []);
  assert.ok(!f.render('CANCELLATION', 'zh-HK').details.some((row) => row.label === '訂金'));
});
