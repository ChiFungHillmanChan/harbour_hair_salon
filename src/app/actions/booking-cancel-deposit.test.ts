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
 * DEPOSIT_REFUND_NOTICE_HOURS (48) or more ahead is refunded in full, and
 * one cancelled later (online until 24 hours ahead) keeps it (owner decision 2026-10-18).
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
  assert.deepEqual(await f.customer.cancelAppointment(f.booking.id), { success: false, code: 'DEPOSIT_IN_PROGRESS', error: bookingErrorText('en-GB', 'DEPOSIT_IN_PROGRESS') });
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
  assert.deepEqual(await unknown.customer.cancelAppointment(unknown.booking.id), { success: false, code: 'DEPOSIT_IN_PROGRESS', error: bookingErrorText('en-GB', 'DEPOSIT_IN_PROGRESS') });
  assert.deepEqual([unknown.booking.status, unknown.attempts[0].status], ['PENDING', 'CAPTURE_UNKNOWN']);
});

test('a capture that went unanswered moments ago: the customer is asked to try again shortly, and Square is not asked yet', async () => {
  const f = depositFixture({ deposit: { status: 'CAPTURE_UNKNOWN', updatedAt: minutes(-1) } });
  assert.deepEqual(await f.customer.cancelAppointment(f.booking.id), { success: false, code: 'DEPOSIT_IN_PROGRESS', error: bookingErrorText('en-GB', 'DEPOSIT_IN_PROGRESS') });
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

// --- The 48-hour refund rule (owner decision 2026-10-18) ---------------------

const HOUR = 60;

test('cancelling 48 hours or more ahead refunds the deposit in full — exactly 48 hours counts as in time', async () => {
  for (const ahead of [3 * 24 * HOUR, 48 * HOUR]) {
    // What the confirm step showed makes no difference to a refund.
    for (const depositKept of [undefined, true]) {
      const f = depositFixture({ status: 'CONFIRMED', date: minutes(ahead), deposit: CAPTURED_DEPOSIT });
      assert.deepEqual(await f.customer.cancelAppointment(f.booking.id, depositKept === undefined ? undefined : { depositKept }), { success: true }, `${ahead} minutes ahead`);
      assert.equal(f.booking.status, 'CANCELLED');
      assert.equal(f.attempts[0].status, 'CAPTURED', 'refunded, never recorded kept');
      assert.deepEqual(f.refunds.map((refund) => [refund.amountPence, refund.reason]), [[2000, 'CUSTOMER_CANCELLED']]);
      assert.equal(f.squareCalls.refund.length, 1);
      assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.options]), [['CANCELLATION', { wasConfirmed: true, depositOutcome: 'REFUNDING' }]]);
    }
  }
});

test('cancelling less than 48 hours ahead keeps the deposit: recorded KEPT, no refund, and the email says so', async () => {
  for (const ahead of [48 * HOUR - 1, 30 * HOUR, 24 * HOUR]) {
    const f = depositFixture({ status: 'CONFIRMED', date: minutes(ahead), deposit: CAPTURED_DEPOSIT });
    assert.deepEqual(await f.customer.cancelAppointment(f.booking.id, { depositKept: true }), { success: true }, `${ahead} minutes ahead`);
    assert.equal(f.booking.status, 'CANCELLED');
    assert.equal(f.attempts[0].status, 'KEPT', 'the staff-keep outcome: reconciliation never refunds it');
    assert.deepEqual(f.refunds, [], 'no refund row');
    assert.deepEqual(f.squareCalls.order, [], 'Square is not asked for anything');
    assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.options, notice.deposit]), [
      ['CANCELLATION', { wasConfirmed: true, depositOutcome: 'KEPT' }, { amountPence: 2000, status: 'CAPTURED' }],
    ]);
    const english = f.render('CANCELLATION', 'en-GB');
    assert.deepEqual(english.details.at(-1), { label: 'Deposit', value: '£20.00 kept' });
    assert.equal(english.footnotes[0], 'The £20.00 deposit is kept under our booking terms (a cancellation less than 48 hours before the appointment, or a missed appointment).');
    assert.equal(f.render('CANCELLATION', 'zh-HK').footnotes[0], '根據我們的預約條款（預約前不足 48 小時取消，或缺席預約），£20.00 訂金不予退還。');
    assert.equal(f.counts.invalidations, 1);
  }
});

test('a deposit is never kept without the customer being told: a confirm step that promised a refund is refused and nothing changes', async () => {
  for (const options of [undefined, {}, { depositKept: false }]) {
    const f = depositFixture({ status: 'CONFIRMED', date: minutes(47 * HOUR + 59), deposit: CAPTURED_DEPOSIT });
    const answer = await f.customer.cancelAppointment(f.booking.id, options);
    assert.deepEqual(answer, { success: false, code: 'DEPOSIT_NOW_KEPT', error: bookingErrorText('en-GB', 'DEPOSIT_NOW_KEPT', { hours: 48 }) });
    assert.match(answer.success ? '' : answer.error, /less than 48 hours/);
    assert.deepEqual([f.booking.status, f.attempts[0].status, f.refunds, f.squareCalls.order, f.queued()], ['CONFIRMED', 'CAPTURED', [], [], []], 'rolled back whole');
  }
});

test('a booking moved at a request made inside 48 hours keeps its deposit whenever it is cancelled, and the email says why', async () => {
  const f = depositFixture({ status: 'CONFIRMED', date: minutes(10 * 24 * 60), depositLockedAt: minutes(-60), deposit: CAPTURED_DEPOSIT });
  assert.deepEqual(await f.customer.cancelAppointment(f.booking.id, { depositKept: true }), { success: true });
  assert.equal(f.attempts[0].status, 'KEPT');
  assert.deepEqual([f.refunds, f.squareCalls.order], [[], []], 'ten days ahead, yet nothing is refunded');
  assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.options]), [
    ['CANCELLATION', { wasConfirmed: true, depositOutcome: 'KEPT', depositLocked: true }],
  ]);
  assert.equal(f.render('CANCELLATION', 'en-GB').footnotes[0], 'The £20.00 deposit is kept under our booking terms: you asked to move this booking less than 48 hours before it.');
  assert.equal(f.render('CANCELLATION', 'zh-HK').footnotes[0], '根據我們的預約條款，由於你在預約前不足 48 小時申請改期，£20.00 訂金不予退還。');
});

test('a locked deposit is never kept without the customer being told', async () => {
  const f = depositFixture({ status: 'CONFIRMED', date: minutes(10 * 24 * 60), depositLockedAt: minutes(-60), deposit: CAPTURED_DEPOSIT });
  const answer = await f.customer.cancelAppointment(f.booking.id);
  assert.equal(!answer.success && answer.code, 'DEPOSIT_NOW_KEPT');
  assert.deepEqual([f.booking.status, f.attempts[0].status, f.refunds, f.queued()], ['CONFIRMED', 'CAPTURED', [], []]);
});

test('a request is not a booking: withdrawing it inside 48 hours still releases the hold, and money taken on it is refunded', async () => {
  const held = depositFixture({ date: minutes(30 * HOUR) });
  assert.deepEqual(await held.customer.cancelAppointment(held.booking.id), { success: true });
  assert.equal(held.attempts[0].status, 'VOIDED');
  assert.deepEqual(held.squareCalls.order, ['cancel']);
  assert.deepEqual(held.queued().map((notice) => notice.options), [{ wasConfirmed: false, depositOutcome: 'RELEASED' }]);

  // Square shows the hold taken on a still-PENDING request (PAYMENT_CAPTURED_NOT_CONFIRMED).
  const taken = depositFixture({ date: minutes(30 * HOUR), deposit: CAPTURED_DEPOSIT });
  assert.deepEqual(await taken.customer.cancelAppointment(taken.booking.id), { success: true });
  assert.deepEqual(taken.refunds.map((refund) => refund.reason), ['CUSTOMER_CANCELLED']);
  assert.equal(taken.queued()[0].options.depositOutcome, 'REFUNDING');
});

test('a confirmed booking without a deposit is cancelled inside 48 hours as before, with nothing to acknowledge', async () => {
  const f = depositFixture({ status: 'CONFIRMED', date: minutes(30 * HOUR), deposit: null });
  assert.deepEqual(await f.customer.cancelAppointment(f.booking.id), { success: true });
  assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.options]), [['CANCELLATION', { wasConfirmed: true }]]);
});
