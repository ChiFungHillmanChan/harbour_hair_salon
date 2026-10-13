import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, minutes, NOW, paymentEvent, refundEvent } from '../../test/payments-fixture';
import {
  heldWithoutBooking, isForeignSquareEvent, noticeNeedsCheck, parseSquareWebhookEvent, paymentNoticeChange, type NoticeAttempt,
} from './square-webhook-events';
import { OPERATIONS_MESSAGES } from './operations-messages';

const row = (values: Partial<NoticeAttempt>): NoticeAttempt => ({
  id: 'a1', status: 'AUTHORIZED', amountPence: 2000, squarePaymentId: 'pay-a1', environment: 'sandbox', locationId: CONFIG.locationId,
  lastError: null, createdAt: minutes(-60), updatedAt: minutes(-60), appointmentId: 'appt-1', appointment: { status: 'PENDING' }, ...values,
});

test('a body is a handled event, an ignored type, or not a Square event at all', () => {
  assert.equal(parseSquareWebhookEvent('nope'), null);
  assert.equal(parseSquareWebhookEvent(JSON.stringify({ type: 'payment.updated', data: {} })), null, 'no event id');
  assert.equal(parseSquareWebhookEvent(JSON.stringify({ event_id: 'e', type: 'customer.created', data: {} })), 'IGNORED');
  const payment = parseSquareWebhookEvent(paymentEvent('e1', 'payment.updated', { id: 'pay-1', status: 'COMPLETED', referenceId: 'a1' }));
  assert.deepEqual(payment && payment !== 'IGNORED' && [payment.kind, payment.eventId, payment.objectId], ['payment', 'e1', 'pay-1']);
  const refund = parseSquareWebhookEvent(refundEvent('e2', 'refund.created', { id: 'r-1', status: 'PENDING', paymentId: 'pay-1' }));
  assert.deepEqual(refund && refund !== 'IGNORED' && [refund.kind, refund.objectId], ['refund', 'r-1']);
  // A known type whose object Square shaped differently is kept (unmatched), not refused.
  const odd = parseSquareWebhookEvent(JSON.stringify({ event_id: 'e3', type: 'payment.updated', data: { id: 'pay-2', object: { payment: { id: 'pay-2' } } } }));
  assert.deepEqual(odd, { kind: 'unreadable', eventId: 'e3', type: 'payment.updated', objectId: 'pay-2', locationId: null });
  // …with whatever location it still names, for the check before the database.
  const located = parseSquareWebhookEvent(JSON.stringify({ event_id: 'e4', type: 'refund.updated', data: { id: 'r-2', object: { refund: { id: 'r-2', location_id: 'L1' } } } }));
  assert.deepEqual(located, { kind: 'unreadable', eventId: 'e4', type: 'refund.updated', objectId: 'r-2', locationId: 'L1' });
});

// Review W-B: Square notifies every payment and refund on the account. An
// event its schema cannot read still names its location: another location's is
// acknowledged before the database is opened, like a readable one.
test('refund events and unreadable events of another location are foreign before any database access', () => {
  const parse = (body: unknown) => parseSquareWebhookEvent(JSON.stringify(body)) as Exclude<ReturnType<typeof parseSquareWebhookEvent>, null | 'IGNORED'>;
  const odd = (type: string, key: 'payment' | 'refund', locationId?: unknown) =>
    parse({ event_id: `e-${type}-${String(locationId)}`, type, data: { id: 'x', object: { [key]: { id: 'x', ...(locationId === undefined ? {} : { location_id: locationId }) } } } });
  assert.equal(isForeignSquareEvent(odd('payment.updated', 'payment', 'another-location'), CONFIG), true);
  assert.equal(isForeignSquareEvent(odd('refund.created', 'refund', 'another-location'), CONFIG), true);
  // This location, no location at all, or one that is not even text: kept (listed as unmatched).
  assert.equal(isForeignSquareEvent(odd('payment.updated', 'payment', CONFIG.locationId), CONFIG), false);
  assert.equal(isForeignSquareEvent(odd('refund.updated', 'refund'), CONFIG), false);
  assert.equal(isForeignSquareEvent(odd('refund.updated', 'refund', 42), CONFIG), false);
  // Readable refunds: the location is the only thing known before the database.
  assert.equal(isForeignSquareEvent(parse(JSON.parse(refundEvent('e', 'refund.updated', { id: 'r', status: 'COMPLETED', paymentId: 'p', locationId: 'another-location' }))), CONFIG), true);
  assert.equal(isForeignSquareEvent(parse(JSON.parse(refundEvent('e', 'refund.updated', { id: 'r', status: 'COMPLETED', paymentId: 'p' }))), CONFIG), false);
});

test('events that cannot be about a deposit are recognised without the database', () => {
  const parse = (body: string) => parseSquareWebhookEvent(body) as Exclude<ReturnType<typeof parseSquareWebhookEvent>, null | 'IGNORED'>;
  assert.equal(isForeignSquareEvent(parse(paymentEvent('e', 'payment.created', { id: 'p', status: 'COMPLETED', referenceId: null })), CONFIG), true, 'in-salon payment');
  assert.equal(isForeignSquareEvent(parse(paymentEvent('e', 'payment.created', { id: 'p', status: 'COMPLETED', referenceId: 'x'.repeat(41) })), CONFIG), true, 'not a deposit reference');
  assert.equal(isForeignSquareEvent(parse(paymentEvent('e', 'payment.created', { id: 'p', status: 'COMPLETED', referenceId: 'a1', locationId: 'other' })), CONFIG), true);
  assert.equal(isForeignSquareEvent(parse(refundEvent('e', 'refund.created', { id: 'r', status: 'PENDING', paymentId: 'p', locationId: 'other' })), CONFIG), true);
  assert.equal(isForeignSquareEvent(parse(paymentEvent('e', 'payment.created', { id: 'p', status: 'APPROVED', referenceId: 'cm0abc123def456ghi789jkl0' })), CONFIG), false);
  assert.equal(isForeignSquareEvent(parse(refundEvent('e', 'refund.created', { id: 'r', status: 'PENDING', paymentId: 'p' })), CONFIG), false);
});

test('which holds no booking wants: never one its open request needs, or one still in its submission\'s hands', () => {
  const young = { createdAt: minutes(-1) };
  assert.equal(heldWithoutBooking(row({}), NOW), false, 'a PENDING request\'s hold');
  assert.equal(heldWithoutBooking(row({ appointment: { status: 'CANCELLED' } }), NOW), true);
  assert.equal(heldWithoutBooking(row({ appointment: { status: 'CONFIRMED' } }), NOW), true, 'not PENDING: nothing will ever capture it');
  assert.equal(heldWithoutBooking(row({ appointmentId: null, appointment: null }), NOW), true);
  assert.equal(heldWithoutBooking(row({ appointmentId: null, appointment: null, ...young }), NOW), false, 'being linked to its new booking');
  for (const status of ['UNKNOWN', 'VOIDED', 'FAILED', 'EXPIRED']) assert.equal(heldWithoutBooking(row({ status }), NOW), true, status);
  assert.equal(heldWithoutBooking(row({ status: 'INITIATED', ...young }), NOW), false);
  assert.equal(heldWithoutBooking(row({ status: 'INITIATED' }), NOW), true, 'a submission that died');
  for (const status of ['CAPTURING', 'CAPTURE_UNKNOWN', 'CAPTURED']) assert.equal(heldWithoutBooking(row({ status }), NOW), false, status);
});

test('only Square\'s final word changes a status; APPROVED never does', () => {
  // APPROVED: never a status move (it may be older than what is known).
  for (const status of ['AUTHORIZED', 'CAPTURING', 'CAPTURE_UNKNOWN', 'CAPTURED', 'VOIDED', 'EXPIRED']) {
    assert.equal(paymentNoticeChange(row({ status }), { id: 'pay-a1', status: 'APPROVED' }, NOW), null, status);
  }
  assert.deepEqual(paymentNoticeChange(row({ status: 'UNKNOWN', squarePaymentId: null }), { id: 'pay-x', status: 'APPROVED' }, NOW)?.data, { squarePaymentId: 'pay-x' });
  // COMPLETED: only a capture nobody saw finish.
  assert.equal(paymentNoticeChange(row({}), { id: 'pay-a1', status: 'COMPLETED' }, NOW), null, 'a hold: reconciliation reads Square first');
  assert.equal(paymentNoticeChange(row({ status: 'CAPTURING', updatedAt: new Date(NOW.getTime() - 30_000) }), { id: 'pay-a1', status: 'COMPLETED' }, NOW), null);
  assert.deepEqual(paymentNoticeChange(row({ status: 'CAPTURE_UNKNOWN' }), { id: 'pay-a1', status: 'COMPLETED' }, NOW)?.data,
    { status: 'CAPTURED', capturedAt: NOW, lastError: OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED });
  // CANCELED: forward, and never for a capture still being made.
  assert.equal(paymentNoticeChange(row({ status: 'CAPTURED' }), { id: 'pay-a1', status: 'CANCELED' }, NOW), null);
  assert.equal(paymentNoticeChange(row({ status: 'INITIATED' }), { id: 'pay-a1', status: 'CANCELED' }, NOW), null);
  assert.deepEqual(paymentNoticeChange(row({ status: 'CAPTURE_UNKNOWN' }), { id: 'pay-a1', status: 'CANCELED' }, NOW)?.data,
    { status: 'EXPIRED', lastError: OPERATIONS_MESSAGES.PAYMENT_HOLD_CANCELLED });
  // Every write is conditional on the row exactly as it was read.
  assert.deepEqual(paymentNoticeChange(row({}), { id: 'pay-a1', status: 'CANCELED' }, NOW)?.where, { id: 'a1', status: 'AUTHORIZED', updatedAt: minutes(-60) });
});

test('a notice asks for a fresh read only when Square may hold or have taken money no booking wants', () => {
  assert.equal(noticeNeedsCheck(row({}), 'APPROVED', NOW), false);
  assert.equal(noticeNeedsCheck(row({ status: 'VOIDED' }), 'APPROVED', NOW), true);
  assert.equal(noticeNeedsCheck(row({}), 'COMPLETED', NOW), true, 'taken while believed only held');
  assert.equal(noticeNeedsCheck(row({ status: 'CAPTURE_UNKNOWN' }), 'COMPLETED', NOW), false, 'recorded directly');
  assert.equal(noticeNeedsCheck(row({ status: 'CAPTURED' }), 'COMPLETED', NOW), false);
  assert.equal(noticeNeedsCheck(row({ status: 'VOIDED' }), 'CANCELED', NOW), false);
  // Kept by staff: Square showing it taken is exactly what was decided.
  for (const status of ['APPROVED', 'COMPLETED', 'CANCELED']) {
    assert.equal(noticeNeedsCheck(row({ status: 'KEPT', appointment: { status: 'CANCELLED' } }), status, NOW), false, status);
    assert.equal(paymentNoticeChange(row({ status: 'KEPT', appointment: { status: 'CANCELLED' } }), { id: 'pay-a1', status }, NOW), null, status);
  }
});
