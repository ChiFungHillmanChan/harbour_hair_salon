import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { depositFixture, minutes, NOW } from '../../test/deposit-fixture';
import { SquareGatewayError } from '../services/square-gateway';
import { OPERATIONS_MESSAGES } from '../services/operations-messages';
import { bookingErrorText } from '../services/booking-errors';
import { renderPlainText } from '../services/email-content';

/**
 * Staff decisions on a booking that holds a card deposit (phase S3 of
 * docs/superpowers/specs/2026-10-13-square-deposits-design.md), through the
 * real updateAppointmentStatus, deposit lifecycle and outbox over a stateful
 * fake database and a fake Square. Confirming TAKES the deposit (capture);
 * declining RELEASES the hold; cancelling a confirmed booking REFUNDS it, or
 * staff keep it. Date is fixed at NOW.
 */

before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

const text = (code: Parameters<typeof bookingErrorText>[1], params?: Record<string, string>) => bookingErrorText('en-GB', code, params);
const CAPTURED_DEPOSIT = { status: 'CAPTURED', capturedAt: minutes(-60) };

async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const errors = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = errors;
  }
}

test('confirming a request takes its deposit: read Square, capture with its version, then CONFIRMED and CAPTURED together', async () => {
  const f = depositFixture();
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED'), { success: true });
  assert.deepEqual(f.squareCalls.order, ['getPayment', 'capture'], 'read first, then one capture');
  assert.deepEqual(f.squareCalls.capture, [{ paymentId: 'square-payment-1', amountPence: 2000, referenceId: 'attempt-1', versionToken: 'v1' }]);
  assert.equal(f.squarePayments.get('square-payment-1')?.status, 'COMPLETED');
  assert.equal(f.booking.status, 'CONFIRMED');
  assert.equal(f.booking.notificationVersion, 1);
  const [attempt] = f.attempts;
  assert.equal(attempt.status, 'CAPTURED');
  assert.ok(attempt.capturedAt instanceof Date);
  assert.equal(attempt.lastError, null);
  assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.deposit]), [['CONFIRMATION', { amountPence: 2000, status: 'CAPTURED' }]]);
  assert.deepEqual(f.audits.map((audit) => [audit.action, audit.metadata]), [['APPOINTMENT.STATUS', { from: 'PENDING', to: 'CONFIRMED', deposit: 'CAPTURED', depositPence: 2000 }]]);
  assert.deepEqual([f.counts.refreshes, f.counts.dispatches, f.counts.invalidations], [1, 1, 1]);

  // Confirming again changes nothing and never touches Square.
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED'), { success: true });
  assert.equal(f.squareCalls.capture.length, 1);
  assert.equal(f.queued().length, 1);
});

test('the confirmation email says what was paid and what is left to pay in the salon, in both languages', async () => {
  const f = depositFixture();
  await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED');
  const english = f.render('CONFIRMATION', 'en-GB');
  assert.deepEqual(english.details.at(-1), { label: 'Deposit', value: '£20.00 paid' });
  assert.ok(english.footnotes.includes('Your £20.00 deposit is paid; £80.00 is left to pay in the salon. Cash and card are accepted.'));
  assert.match(renderPlainText(english), /Deposit: £20\.00 paid/);
  const chinese = f.render('CONFIRMATION', 'zh-HK');
  assert.deepEqual(chinese.details.at(-1), { label: '訂金', value: '已付 £20.00' });
  assert.ok(chinese.footnotes.includes('你已繳付 £20.00 訂金；餘下 £80.00 於店內繳付，接受現金及信用卡。'));
});

test('two staff confirming at once: one capture, one confirmation; the other is told it is being processed', async () => {
  // Both pass the check before the transaction while the hold is AUTHORIZED.
  // A claims it first and is still with Square when B's transaction runs, so
  // B's conditional claim finds it CAPTURING.
  let b: Promise<unknown> | null = null;
  let bPastCheck!: () => void;
  const bReady = new Promise<void>((resolve) => { bPastCheck = resolve; });
  let aClaimed!: () => void;
  const claimed = new Promise<void>((resolve) => { aClaimed = resolve; });
  let refreshes = 0;
  const f = depositFixture({
    onFeedRefresh: async () => {
      if (++refreshes === 1) {
        b = f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED');
        await bReady;
      } else {
        bPastCheck();
        await claimed;
      }
    },
    square: { getPayment: async (_id, real) => { aClaimed(); await b; return real(); } },
  });
  const aAnswer = await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED');
  const bAnswer = await b;
  assert.deepEqual(aAnswer, { success: true });
  assert.deepEqual(bAnswer, { success: false, refresh: true, error: text('DEPOSIT_IN_PROGRESS') });
  assert.equal(f.counts.refreshes, 2, 'both passed the check before the transaction');
  assert.equal(f.squareCalls.capture.length, 1, 'the deposit is taken once');
  assert.equal(f.attempts[0].status, 'CAPTURED');
  assert.equal(f.booking.status, 'CONFIRMED');
  assert.deepEqual(f.queued().map((notice) => notice.kind), ['CONFIRMATION']);

  // An approval while another is still with Square is refused before any work.
  const g = depositFixture({ deposit: { status: 'CAPTURING', updatedAt: NOW } });
  assert.deepEqual(await g.admin.updateAppointmentStatus(g.booking.id, 'CONFIRMED'), { success: false, error: text('DEPOSIT_IN_PROGRESS') });
  assert.equal(g.counts.refreshes, 0);
  assert.deepEqual(g.squareCalls.order, []);
});

test('a request whose card hold has run out (or gone) cannot be confirmed: nothing is asked of Square', async () => {
  for (const deposit of [
    { status: 'AUTHORIZED', delayedUntil: minutes(-1) },
    { status: 'AUTHORIZED', delayedUntil: NOW },
    { status: 'EXPIRED' },
    { status: 'VOIDED' },
  ]) {
    const f = depositFixture({ deposit });
    assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED'), {
      success: false, error: 'The card hold for this request has expired, so it can no longer be confirmed online. Decline it and contact the customer.',
    }, JSON.stringify(deposit));
    assert.deepEqual(f.squareCalls.order, []);
    assert.equal(f.counts.refreshes, 0, 'refused before the feed refresh');
    assert.equal(f.booking.status, 'PENDING');
    assert.equal(f.attempts[0].status, deposit.status, 'the lapse step closes it');
  }
});

test('Square refusing the capture leaves the hold as it was and the request pending', async () => {
  const f = depositFixture({ square: { capture: async () => { throw new SquareGatewayError('provider_error', 400); } } });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED'), { success: false, refresh: true, error: text('DEPOSIT_CAPTURE_FAILED') });
  assert.deepEqual(f.squareCalls.order, ['getPayment', 'capture', 'getPayment'], 'what does Square say now?');
  assert.equal(f.attempts[0].status, 'AUTHORIZED');
  assert.equal(f.attempts[0].lastError, OPERATIONS_MESSAGES.PAYMENT_CAPTURE_REFUSED);
  assert.equal(f.booking.status, 'PENDING');
  assert.deepEqual([f.queued(), f.audits], [[], []]);
});

test('a refused capture whose hold Square has already cancelled records it EXPIRED', async () => {
  const f = depositFixture({
    square: { capture: async (input) => { f.squarePayments.get(input.paymentId)!.status = 'CANCELED'; throw new SquareGatewayError('provider_error', 400); } },
  });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED'), { success: false, refresh: true, error: text('DEPOSIT_HOLD_EXPIRED') });
  assert.equal(f.attempts[0].status, 'EXPIRED');
  assert.equal(f.attempts[0].lastError, OPERATIONS_MESSAGES.PAYMENT_HOLD_CANCELLED);
  assert.equal(f.booking.status, 'PENDING');
});

test('a capture with no answer that Square shows COMPLETED is confirmed', async () => {
  const f = depositFixture({ square: { capture: async (_input, real) => { real(); throw new SquareGatewayError('unknown_outcome'); } } });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED'), { success: true });
  assert.deepEqual(f.squareCalls.order, ['getPayment', 'capture', 'getPayment']);
  assert.equal(f.attempts[0].status, 'CAPTURED');
  assert.equal(f.booking.status, 'CONFIRMED');
  assert.deepEqual(f.queued().map((notice) => notice.kind), ['CONFIRMATION']);
});

test('a capture with no answer and no proof is CAPTURE_UNKNOWN; the retry reads Square first and never captures blindly', async () => {
  let lateCapture: (() => unknown) | null = null;
  const f = depositFixture({
    // Square takes it a moment after the timeout: not yet visible to the follow-up read.
    square: { capture: async (_input, real) => { lateCapture = real; throw new SquareGatewayError('unknown_outcome'); } },
  });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED'), { success: false, refresh: true, error: text('DEPOSIT_CAPTURE_UNKNOWN') });
  assert.equal(f.attempts[0].status, 'CAPTURE_UNKNOWN');
  assert.equal(f.attempts[0].lastError, OPERATIONS_MESSAGES.PAYMENT_CAPTURE_UNKNOWN);
  assert.equal(f.booking.status, 'PENDING');
  assert.deepEqual(f.queued(), []);

  lateCapture!();
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED'), { success: true });
  assert.deepEqual(f.squareCalls.order, ['getPayment', 'capture', 'getPayment', 'getPayment'], 'the retry only reads: it was taken');
  assert.equal(f.squareCalls.capture.length, 1);
  assert.equal(f.attempts[0].status, 'CAPTURED');
  assert.equal(f.booking.status, 'CONFIRMED');
});

test('a retry after an unanswered capture that Square shows still held captures, after reading it', async () => {
  const f = depositFixture({ deposit: { status: 'CAPTURE_UNKNOWN', lastError: OPERATIONS_MESSAGES.PAYMENT_CAPTURE_UNKNOWN } });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED'), { success: true });
  assert.deepEqual(f.squareCalls.order, ['getPayment', 'capture']);
  assert.equal(f.attempts[0].status, 'CAPTURED');
  assert.equal(f.attempts[0].lastError, null);
});

test('the time taken between the capture and the confirmation: the request is cancelled and the deposit refunded in full', async () => {
  // Slot check 1 is in the claiming transaction, check 2 in the confirming one.
  const f = depositFixture({ slotLostOnCheck: 2 });
  const answer = await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED');
  assert.deepEqual(answer, {
    success: false, refresh: true,
    error: 'The time was taken while the deposit was being processed, so the request was cancelled and the customer’s £20.00 deposit is being refunded. They have been emailed.',
  });
  assert.equal(f.booking.status, 'CANCELLED');
  assert.equal(f.attempts[0].status, 'CAPTURED', 'it was taken');
  assert.equal(f.refunds.length, 1);
  const [refund] = f.refunds;
  assert.deepEqual([refund.amountPence, refund.reason, refund.requestedById], [2000, 'SLOT_LOST', null]);
  assert.match(refund.idempotencyKey, /^rfd_[0-9a-f]{32}$/);
  assert.deepEqual(f.squareCalls.refund, [{ paymentId: 'square-payment-1', amountPence: 2000, idempotencyKey: refund.idempotencyKey }], 'asked after the commit, with the row’s key');
  assert.equal(refund.status, 'PENDING');
  assert.equal(refund.squareRefundId, `square-${refund.idempotencyKey}`);
  assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.options]), [['CANCELLATION', { wasConfirmed: false, depositOutcome: 'REFUNDING' }]]);
  assert.deepEqual(f.audits.at(-1)?.metadata, { from: 'PENDING', to: 'CANCELLED', reason: 'SLOT_LOST', deposit: 'REFUNDING', depositPence: 2000 });
  const english = f.render('CANCELLATION', 'en-GB');
  assert.ok(english.footnotes.includes('Your £20.00 deposit is being refunded. Most banks show refunds within 5–10 working days; some take up to 14.'));
  assert.ok(!english.footnotes.some((note) => /\.ics/.test(note)), 'a request was never in their calendar');
  const chinese = f.render('CANCELLATION', 'zh-HK');
  assert.ok(chinese.footnotes.includes('你的 £20.00 訂金正在退還。大部分銀行會於 5 至 10 個工作天內顯示退款，部分銀行或需長達 14 個工作天。'));
});

test('a failure saving the confirmation after the capture records the deposit taken; confirming again never takes it twice', async () => {
  // Transaction 1 claims, transaction 2 (confirming) fails.
  const f = depositFixture({ failTransaction: 2 });
  assert.deepEqual(await quietly(() => f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED')), { success: false, refresh: true, error: text('DEPOSIT_TAKEN_NOT_CONFIRMED') });
  assert.equal(f.booking.status, 'PENDING');
  assert.equal(f.attempts[0].status, 'CAPTURED');
  assert.equal(f.attempts[0].lastError, OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED);
  assert.deepEqual(f.queued(), [], 'nothing was confirmed, so nothing was queued');

  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED'), { success: true });
  assert.deepEqual(f.squareCalls.order, ['getPayment', 'capture'], 'the retry asks Square nothing');
  assert.equal(f.booking.status, 'CONFIRMED');
  assert.equal(f.attempts[0].lastError, null);
  assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.deposit]), [['CONFIRMATION', { amountPence: 2000, status: 'CAPTURED' }]]);
});

test('without usable Square payments here a deposit cannot be taken: refused before anything changes', async () => {
  const f = depositFixture({ paymentsOff: true });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED'), { success: false, error: text('DEPOSIT_PAYMENTS_UNAVAILABLE') });
  assert.deepEqual([f.squareCalls.order, f.counts.refreshes, f.attempts[0].status, f.booking.status], [[], 0, 'AUTHORIZED', 'PENDING']);
  // Nor a deposit taken in another Square environment (a preview deployment on a copy of production).
  const other = depositFixture({ deposit: { environment: 'production' } });
  assert.deepEqual(await other.admin.updateAppointmentStatus(other.booking.id, 'CONFIRMED'), { success: false, error: text('DEPOSIT_PAYMENTS_UNAVAILABLE') });
  assert.deepEqual(other.squareCalls.order, []);
});

test('declining a request releases its hold after the decline commits, and the email says so', async () => {
  const f = depositFixture();
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CANCELLED'), { success: true });
  assert.equal(f.booking.status, 'CANCELLED');
  assert.deepEqual(f.squareCalls.cancel, [{ paymentId: 'square-payment-1', amountPence: 2000, referenceId: 'attempt-1' }]);
  assert.equal(f.attempts[0].status, 'VOIDED');
  assert.deepEqual(f.refunds, []);
  assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.options, notice.deposit]), [
    ['CANCELLATION', { wasConfirmed: false, depositOutcome: 'RELEASED' }, { amountPence: 2000, status: 'AUTHORIZED' }],
  ]);
  assert.deepEqual(f.audits[0].metadata, { from: 'PENDING', to: 'CANCELLED', deposit: 'RELEASED', depositPence: 2000 });
  const english = f.render('CANCELLATION', 'en-GB');
  assert.deepEqual(english.details.at(-1), { label: 'Deposit', value: '£20.00 hold released — nothing taken' });
  assert.ok(english.footnotes.includes('The £20.00 hold on your card has been released — nothing was taken. Your bank may take a few days to remove it.'));
  const chinese = f.render('CANCELLATION', 'zh-HK');
  assert.ok(chinese.footnotes.includes('你信用卡上 £20.00 的預留款項已經解除——並沒有扣款。銀行或需數天才會更新紀錄。'));
});

test('declining a request whose time has come sends the request-lapsed email, mentioning the released hold', async () => {
  const f = depositFixture({ date: minutes(-30), announced: true });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CANCELLED'), { success: true });
  assert.equal(f.attempts[0].status, 'VOIDED');
  assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.options]), [['REQUEST_LAPSED', { salonPhone: '07831 830898', depositOutcome: 'RELEASED' }]]);
  assert.ok(f.render('REQUEST_LAPSED', 'en-GB').footnotes.includes('The £20.00 hold on your card has been released — nothing was taken. Your bank may take a few days to remove it.'));
});

test('a hold that cannot be released stays AUTHORIZED for reconciliation; the decline stands', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = depositFixture({ square: { cancel: async () => { throw new SquareGatewayError('unknown_outcome'); } } });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CANCELLED'), { success: true });
  assert.equal(f.booking.status, 'CANCELLED');
  assert.equal(f.attempts[0].status, 'AUTHORIZED');
  assert.equal(f.attempts[0].lastError, OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED);
});

test('staff cancelling a confirmed booking refund its deposit in full by default', async () => {
  const f = depositFixture({ status: 'CONFIRMED', deposit: CAPTURED_DEPOSIT });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CANCELLED'), { success: true });
  assert.equal(f.booking.status, 'CANCELLED');
  const [refund] = f.refunds;
  assert.deepEqual([f.refunds.length, refund.amountPence, refund.reason, refund.requestedById, refund.status], [1, 2000, 'STAFF_CANCELLED', 'admin-1', 'PENDING']);
  assert.deepEqual(f.squareCalls.refund.map((call) => [call.amountPence, call.idempotencyKey, call.reason]), [[2000, refund.idempotencyKey, undefined]]);
  assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.options]), [['CANCELLATION', { wasConfirmed: true, depositOutcome: 'REFUNDING' }]]);
  assert.deepEqual(f.audits[0].metadata, { from: 'CONFIRMED', to: 'CANCELLED', deposit: 'REFUNDING', depositPence: 2000 });
  // An explicit true is the same.
  const explicit = depositFixture({ status: 'CONFIRMED', deposit: CAPTURED_DEPOSIT });
  assert.deepEqual(await explicit.admin.updateAppointmentStatus(explicit.booking.id, 'CANCELLED', { refundDeposit: true }), { success: true });
  assert.equal(explicit.refunds.length, 1);
});

test('staff may keep a confirmed booking’s deposit: no refund, the audit records the choice, the email says it is kept', async () => {
  const f = depositFixture({ status: 'CONFIRMED', deposit: CAPTURED_DEPOSIT });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CANCELLED', { refundDeposit: false }), { success: true });
  assert.equal(f.booking.status, 'CANCELLED');
  assert.deepEqual([f.refunds, f.squareCalls.order], [[], []]);
  // Recorded on the deposit itself, so nothing later mistakes it for money
  // taken without a reason (the attention list) or refunds it as a late capture.
  assert.equal(f.attempts[0].status, 'KEPT');
  assert.deepEqual(f.audits[0].metadata, { from: 'CONFIRMED', to: 'CANCELLED', deposit: 'KEPT', depositPence: 2000 });
  assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.options]), [['CANCELLATION', { wasConfirmed: true, depositOutcome: 'KEPT' }]]);
  assert.ok(f.render('CANCELLATION', 'en-GB').footnotes.includes('The £20.00 deposit is kept under our booking terms (a cancellation less than 48 hours before the appointment, or a missed appointment).'));
  assert.ok(f.render('CANCELLATION', 'zh-HK').footnotes.includes('根據我們的預約條款（預約前不足 48 小時取消，或缺席預約），£20.00 訂金不予退還。'));
});

test('a request whose deposit was taken but never confirmed is always refunded when declined', async () => {
  const f = depositFixture({ deposit: CAPTURED_DEPOSIT });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CANCELLED', { refundDeposit: false }), { success: true });
  assert.deepEqual(f.refunds.map((refund) => [refund.amountPence, refund.reason]), [[2000, 'STAFF_CANCELLED']]);
  assert.deepEqual(f.queued()[0].options, { wasConfirmed: false, depositOutcome: 'REFUNDING' });
});

test('a refund Square gives no answer for is UNKNOWN; the cancellation stands and nothing is asked twice', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = depositFixture({ status: 'CONFIRMED', deposit: CAPTURED_DEPOSIT, square: { refund: async () => { throw new SquareGatewayError('unknown_outcome'); } } });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CANCELLED'), { success: true });
  assert.equal(f.booking.status, 'CANCELLED');
  assert.equal(f.refunds[0].status, 'UNKNOWN');
  assert.equal(f.squareCalls.refund.length, 1);
  // Cancelling again is a no-op: no second refund row.
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CANCELLED'), { success: true });
  assert.equal(f.refunds.length, 1);
});

test('a deposit already refunded is never refunded again; one whose refund failed can be', async () => {
  const done = depositFixture({ status: 'CONFIRMED', deposit: CAPTURED_DEPOSIT, refunds: [{ status: 'COMPLETED', amountPence: 2000 }] });
  assert.deepEqual(await done.admin.updateAppointmentStatus(done.booking.id, 'CANCELLED'), { success: true });
  assert.equal(done.refunds.length, 1, 'nothing left to refund');
  assert.deepEqual(done.squareCalls.refund, []);
  assert.equal(done.queued()[0].options.depositOutcome, undefined, 'no deposit wording to promise');

  const failed = depositFixture({ status: 'CONFIRMED', deposit: CAPTURED_DEPOSIT, refunds: [{ status: 'FAILED', amountPence: 2000 }] });
  assert.deepEqual(await failed.admin.updateAppointmentStatus(failed.booking.id, 'CANCELLED'), { success: true });
  assert.deepEqual(failed.refunds.map((refund) => refund.status), ['FAILED', 'PENDING']);
});

test('marking completed keeps a taken deposit and releases a hold nobody took', async () => {
  const kept = depositFixture({ status: 'CONFIRMED', date: minutes(-30), deposit: CAPTURED_DEPOSIT });
  assert.deepEqual(await kept.admin.updateAppointmentStatus(kept.booking.id, 'COMPLETED'), { success: true });
  assert.deepEqual([kept.booking.status, kept.attempts[0].status, kept.refunds, kept.squareCalls.order], ['COMPLETED', 'CAPTURED', [], []]);
  assert.deepEqual(kept.audits[0].metadata, { from: 'CONFIRMED', to: 'COMPLETED' });

  const held = depositFixture({ date: minutes(-30) });
  assert.deepEqual(await held.admin.updateAppointmentStatus(held.booking.id, 'COMPLETED'), { success: true });
  assert.equal(held.booking.status, 'COMPLETED');
  assert.equal(held.attempts[0].status, 'VOIDED', 'the customer is not left with a hold for days');
  assert.deepEqual(held.queued(), [], 'completing sends nothing');
});

test('while a deposit is being taken a booking cannot be closed; a stale claim is settled with Square first', async () => {
  const busy = depositFixture({ deposit: { status: 'CAPTURING', updatedAt: NOW } });
  for (const status of ['CANCELLED', 'COMPLETED']) {
    assert.deepEqual(await busy.admin.updateAppointmentStatus(busy.booking.id, status), { success: false, error: text('DEPOSIT_IN_PROGRESS') }, status);
  }
  assert.deepEqual([busy.booking.status, busy.squareCalls.order], ['PENDING', []]);

  // An approval that died after taking the deposit: Square says COMPLETED, so declining refunds it.
  const stale = depositFixture({ deposit: { status: 'CAPTURING', updatedAt: minutes(-5) }, squareStatus: 'COMPLETED' });
  assert.deepEqual(await stale.admin.updateAppointmentStatus(stale.booking.id, 'CANCELLED'), { success: true });
  assert.deepEqual(stale.squareCalls.order, ['getPayment', 'refund']);
  assert.equal(stale.attempts[0].status, 'CAPTURED');
  assert.deepEqual(stale.refunds.map((refund) => [refund.amountPence, refund.reason]), [[2000, 'STAFF_CANCELLED']]);

  // One that died before taking it: still held, so declining releases it.
  const held = depositFixture({ deposit: { status: 'CAPTURE_UNKNOWN' } });
  assert.deepEqual(await held.admin.updateAppointmentStatus(held.booking.id, 'CANCELLED'), { success: true });
  assert.deepEqual(held.squareCalls.order, ['getPayment', 'cancel']);
  assert.equal(held.attempts[0].status, 'VOIDED');
});

// Money-safety review I1: a capture that went unanswered may still land at
// Square; releasing the hold on an early read would let it take money from a
// closed booking. Closings wait until it has been quiet for 2 minutes.
test('a capture that went unanswered moments ago refuses any closing until it has been quiet for 2 minutes; Square is not asked', async () => {
  for (const status of ['CANCELLED', 'COMPLETED']) {
    const fresh = depositFixture({ status: 'PENDING', date: minutes(-90), deposit: { status: 'CAPTURE_UNKNOWN', updatedAt: minutes(-1) } });
    assert.deepEqual(await fresh.admin.updateAppointmentStatus(fresh.booking.id, status), { success: false, error: text('DEPOSIT_IN_PROGRESS') }, status);
    assert.deepEqual([fresh.booking.status, fresh.attempts[0].status, fresh.squareCalls.order], ['PENDING', 'CAPTURE_UNKNOWN', []], status);
  }
  const quiet = depositFixture({ deposit: { status: 'CAPTURE_UNKNOWN', updatedAt: minutes(-3) } });
  assert.deepEqual(await quiet.admin.updateAppointmentStatus(quiet.booking.id, 'CANCELLED'), { success: true });
  assert.deepEqual(quiet.squareCalls.order, ['getPayment', 'cancel']);
  // Confirming may retry at once: it reads Square first and captures with its version, never twice.
  const retry = depositFixture({ deposit: { status: 'CAPTURE_UNKNOWN', updatedAt: minutes(-1) } });
  assert.deepEqual(await retry.admin.updateAppointmentStatus(retry.booking.id, 'CONFIRMED'), { success: true });
  assert.deepEqual(retry.squareCalls.order, ['getPayment', 'capture']);
});

test('a booking without a deposit is confirmed and cancelled exactly as before: Square is never involved', async () => {
  const f = depositFixture({ deposit: null });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED'), { success: true });
  assert.equal(f.booking.status, 'CONFIRMED');
  assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.deposit]), [['CONFIRMATION', null]]);
  assert.deepEqual(f.audits[0].metadata, { from: 'PENDING', to: 'CONFIRMED' });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CANCELLED', { refundDeposit: false }), { success: true });
  assert.deepEqual(f.queued().map((notice) => [notice.kind, notice.options]), [['CONFIRMATION', {}], ['CANCELLATION', { wasConfirmed: true }]]);
  assert.deepEqual(f.squareCalls.order, []);
  const content = f.render('CONFIRMATION', 'en-GB');
  assert.ok(!content.details.some((row) => row.label === 'Deposit'));
  assert.ok(content.footnotes.some((note) => /Payment is due at the salon/.test(note)));
});

test('deposit errors reach the admin in their own language', async () => {
  const f = depositFixture({ deposit: { status: 'EXPIRED' }, locale: 'zh-HK' });
  assert.deepEqual(await f.admin.updateAppointmentStatus(f.booking.id, 'CONFIRMED'), { success: false, error: '此申請的信用卡預留款項已經到期，無法再於網上確認。請拒絕此申請並聯絡客人。' });
  const lost = depositFixture({ slotLostOnCheck: 2, locale: 'zh-HK' });
  const answer = await lost.admin.updateAppointmentStatus(lost.booking.id, 'CONFIRMED');
  assert.equal(!answer.success && answer.error, '處理訂金期間該時段已被預約，因此申請已取消，客人的 £20.00 訂金正在退還，並已以電郵通知客人。');
});
