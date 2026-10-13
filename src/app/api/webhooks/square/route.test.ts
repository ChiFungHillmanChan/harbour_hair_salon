import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../../../test/load-server-module';
import {
  attempt, CONFIG, fakeSquare, minutes, NOW, paymentEvent, paymentsDb, refund, refundEvent, sign,
  type AppointmentRow, type AttemptRow, type EventRow, type RefundRow,
} from '../../../../test/payments-fixture';
import { createPaymentReconciliation } from '../../../services/payment-reconciliation';
import { OPERATIONS_MESSAGES } from '../../../services/operations-messages';

// POST /api/webhooks/square (phase S4 of
// docs/superpowers/specs/2026-10-13-square-deposits-design.md): the real
// route and event service over the in-memory payment tables; Square's own
// follow-up reads go to a fake Square that behaves like Square.

type Seed = { appointments?: AppointmentRow[]; attempts?: AttemptRow[]; refunds?: RefundRow[]; events?: EventRow[] };

function harness(seed: Seed = {}, options: { config?: typeof CONFIG | null } = {}) {
  const store = paymentsDb({ ...seed, now: () => NOW });
  const square = fakeSquare();
  const deferred: (() => Promise<void>)[] = [];
  let databaseOpened = 0;
  const reconciliation = createPaymentReconciliation({ db: store.db as never, config: CONFIG, gatewayFor: () => square.gateway as never, now: () => NOW });
  const route = loadServerModule<typeof import('./route')>('src/app/api/webhooks/square/route.ts', {
    'next/server': { after: (callback: () => Promise<void>) => { deferred.push(callback); } },
    '@/app/lib/online-booking-lock': { usableSquareConfig: () => (options.config === undefined ? CONFIG : options.config) },
    // Counted: the route may open the database only once the event is verified and ours.
    '@/app/lib/prisma': { __esModule: true, get default() { databaseOpened++; return store.db; } },
    '@/app/services/payment-reconciliation': { reconcileSquareEvent: (eventId: string) => reconciliation.reconcileEventById(eventId) },
  });
  const post = (body: string | ReadableStream<Uint8Array>, init: { signature?: string | null; url?: string; headers?: Record<string, string> } = {}) => {
    const signature = init.signature === undefined ? sign(body as string) : init.signature;
    return route.POST(new Request(init.url ?? 'https://preview-or-attacker.example/api/webhooks/square', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(signature === null ? {} : { 'x-square-hmacsha256-signature': signature }), ...init.headers },
      body,
      ...(typeof body === 'string' ? {} : { duplex: 'half' }),
    } as RequestInit));
  };
  return {
    ...store, square, post, deferred,
    databaseOpened: () => databaseOpened,
    /** What `after()` was given, run as Next does once the answer has gone. */
    runAfter: async () => { while (deferred.length) await deferred.shift()!(); },
  };
}

/** Each test runs at the fixture's NOW: the route stamps events and judges ages with the clock. */
function at(name: string, fn: (t: TestContext) => Promise<void>) {
  test(name, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    await fn(t);
  });
}

const booking = (id: string, status: string): AppointmentRow => ({ id, status, date: minutes(3 * 24 * 60) });
const untouched = (h: ReturnType<typeof harness>) => {
  assert.equal(h.databaseOpened(), 0, 'the database is never opened');
  assert.deepEqual(h.calls, []);
};

at('switched off: 404 before the body, the signature or the database', async () => {
  const h = harness({}, { config: null });
  // A body that cannot even be read: the route must not try.
  const unreadable = new ReadableStream<Uint8Array>({ pull() { throw new Error('read'); } });
  const response = await h.post(unreadable, { signature: 'x'.repeat(43) + '=' });
  assert.equal(response.status, 404);
  assert.equal(await response.text(), '');
  untouched(h);
});

at('a missing or wrong signature is refused with 401, without touching the database', async () => {
  const h = harness();
  const body = paymentEvent('evt-1', 'payment.updated', { id: 'pay-a', status: 'COMPLETED', referenceId: 'a' });
  for (const signature of [null, '', 'not-base64', sign(body, CONFIG.webhookNotificationUrl, 'another-key'), sign(`${body} `)]) {
    const response = await h.post(body, { signature });
    assert.equal(response.status, 401, String(signature));
    assert.equal(await response.text(), '', 'nothing is echoed');
  }
  untouched(h);
});

at('the signature covers the configured notification URL, never the Host the request came to', async () => {
  const h = harness();
  const body = JSON.stringify({ event_id: 'evt-host', type: 'customer.created', data: {} });
  // Signed for the URL the request was sent to (a forged Host): refused.
  assert.equal((await h.post(body, { url: 'https://evil.example/api/webhooks/square', signature: sign(body, 'https://evil.example/api/webhooks/square') })).status, 401);
  // Signed for the configured URL, whatever Host it arrived at: accepted.
  assert.equal((await h.post(body, { url: 'https://evil.example/api/webhooks/square' })).status, 200);
  untouched(h);
});

at('a body over 64 KB is refused with 413 before it is read in full or anything is opened', async () => {
  const h = harness();
  const big = JSON.stringify({ event_id: 'evt-big', type: 'payment.updated', padding: 'x'.repeat(70 * 1024) });
  assert.equal((await h.post(big)).status, 413, 'declared length');
  // No declared length (chunked): refused while reading.
  const chunk = new Uint8Array(16 * 1024).fill(32);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (sent++ < 10) controller.enqueue(chunk); else controller.close(); } });
  assert.equal((await h.post(stream, { signature: sign('irrelevant') })).status, 413, 'streamed');
  assert.ok(sent < 10, 'reading stopped once the limit was passed');
  untouched(h);
});

at('other event types, other locations and in-salon payments are acknowledged without opening the database', async () => {
  const h = harness();
  const bodies = [
    JSON.stringify({ event_id: 'evt-o', type: 'order.updated', data: { type: 'order', id: 'o-1', object: {} } }),
    paymentEvent('evt-loc', 'payment.updated', { id: 'pay-x', status: 'COMPLETED', referenceId: 'attempt-x', locationId: 'another-location' }),
    // Taken on a Square reader in the salon: no deposit reference.
    paymentEvent('evt-pos', 'payment.created', { id: 'pay-pos', status: 'COMPLETED', referenceId: null }),
    paymentEvent('evt-ref', 'payment.created', { id: 'pay-ref', status: 'COMPLETED', referenceId: 'not a reference!' }),
    refundEvent('evt-rloc', 'refund.updated', { id: 'r-x', status: 'COMPLETED', paymentId: 'pay-x', locationId: 'another-location' }),
    // Shapes the schema cannot read, from another location (review W-B).
    JSON.stringify({ event_id: 'evt-odd-p', type: 'payment.updated', data: { id: 'pay-odd', object: { payment: { id: 'pay-odd', location_id: 'another-location' } } } }),
    JSON.stringify({ event_id: 'evt-odd-r', type: 'refund.updated', data: { id: 'r-odd', object: { refund: { id: 'r-odd', location_id: 'another-location' } } } }),
  ];
  for (const body of bodies) {
    const response = await h.post(body);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
  }
  untouched(h);
});

at('a signed body that is not a Square event is refused with 400', async () => {
  const h = harness();
  for (const body of ['not json', '{}', JSON.stringify({ type: 'payment.updated' }), JSON.stringify({ event_id: 'evt' })]) {
    assert.equal((await h.post(body)).status, 400, body);
  }
  untouched(h);
});

at('a duplicate delivery is applied once', async () => {
  const h = harness({
    appointments: [booking('appt-1', 'PENDING')],
    attempts: [attempt({ id: 'a1', appointmentId: 'appt-1', status: 'CAPTURE_UNKNOWN', lastError: OPERATIONS_MESSAGES.PAYMENT_CAPTURE_UNKNOWN })],
  });
  const body = paymentEvent('evt-dup', 'payment.updated', { id: 'pay-a1', status: 'COMPLETED', referenceId: 'a1' });
  assert.equal((await h.post(body)).status, 200);
  assert.equal(h.attempt('a1').status, 'CAPTURED');
  assert.equal(h.writes('paymentAttempt'), 1);
  assert.deepEqual(h.event('evt-dup'), { eventId: 'evt-dup', type: 'payment.updated', objectId: 'pay-a1', receivedAt: NOW, processedAt: NOW });
  // Square delivers it again.
  assert.equal((await h.post(body)).status, 200);
  assert.equal(h.writes('paymentAttempt'), 1, 'the second copy changes nothing');
  assert.equal(h.tables.squareWebhookEvent.length, 1);
});

at('a capture nobody saw finish is recorded taken — never confirming the booking', async () => {
  const h = harness({
    appointments: [booking('pending', 'PENDING'), booking('confirmed', 'CONFIRMED'), booking('fresh', 'PENDING'), booking('stale', 'PENDING')],
    attempts: [
      attempt({ id: 'unknown', appointmentId: 'pending', status: 'CAPTURE_UNKNOWN' }),
      attempt({ id: 'confirmed', appointmentId: 'confirmed', status: 'CAPTURE_UNKNOWN' }),
      // An approval claimed it 30 seconds ago and is recording it: its own.
      attempt({ id: 'fresh', appointmentId: 'fresh', status: 'CAPTURING', updatedAt: new Date(NOW.getTime() - 30_000) }),
      // Claimed 5 minutes ago: that approval is gone (CAPTURE_STALE_MS).
      attempt({ id: 'stale', appointmentId: 'stale', status: 'CAPTURING', updatedAt: minutes(-5) }),
    ],
  });
  for (const id of ['unknown', 'confirmed', 'fresh', 'stale']) {
    assert.equal((await h.post(paymentEvent(`evt-${id}`, 'payment.updated', { id: `pay-${id}`, status: 'COMPLETED', referenceId: id }))).status, 200);
  }
  assert.deepEqual([h.attempt('unknown').status, h.attempt('unknown').lastError], ['CAPTURED', OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED]);
  assert.deepEqual([h.attempt('confirmed').status, h.attempt('confirmed').lastError], ['CAPTURED', null]);
  assert.equal(h.attempt('fresh').status, 'CAPTURING', 'a capture in progress belongs to its approval');
  assert.equal(h.attempt('stale').status, 'CAPTURED');
  assert.ok(h.attempt('stale').capturedAt instanceof Date);
  assert.deepEqual(h.tables.appointment.map((row) => row.status), ['PENDING', 'CONFIRMED', 'PENDING', 'PENDING'], 'bookings never change');
  assert.equal(h.calls.filter((call) => call.model === 'appointment' && call.method === 'updateMany').length, 0);
  assert.deepEqual(h.square.calls.order, [], 'Square is not asked about these');
});

at('out of order: an older APPROVED after the capture changes nothing', async () => {
  const h = harness({
    appointments: [booking('appt', 'CONFIRMED'), booking('unsure', 'PENDING')],
    attempts: [
      attempt({ id: 'taken', appointmentId: 'appt', status: 'CAPTURED', capturedAt: minutes(-10) }),
      attempt({ id: 'unsure', appointmentId: 'unsure', status: 'CAPTURE_UNKNOWN' }),
    ],
  });
  await h.post(paymentEvent('evt-new', 'payment.updated', { id: 'pay-taken', status: 'COMPLETED', referenceId: 'taken' }));
  await h.post(paymentEvent('evt-old', 'payment.created', { id: 'pay-taken', status: 'APPROVED', referenceId: 'taken' }));
  // An APPROVED notice may predate the capture: it never says the capture failed.
  await h.post(paymentEvent('evt-old-2', 'payment.created', { id: 'pay-unsure', status: 'APPROVED', referenceId: 'unsure' }));
  assert.equal(h.attempt('taken').status, 'CAPTURED');
  assert.equal(h.attempt('unsure').status, 'CAPTURE_UNKNOWN');
  assert.equal(h.writes('paymentAttempt'), 0);
  assert.equal(h.deferred.length, 0, 'nothing to ask Square');
});

at('a hold Square let go: EXPIRED while its request is open, VOIDED once closed or never booked', async () => {
  const h = harness({
    appointments: [booking('open', 'PENDING'), booking('closed', 'CANCELLED')],
    attempts: [
      attempt({ id: 'open', appointmentId: 'open' }),
      attempt({ id: 'closed', appointmentId: 'closed', lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED }),
      attempt({ id: 'orphan', appointmentId: null }),
      attempt({ id: 'unknown', status: 'UNKNOWN', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_OUTCOME_UNKNOWN }),
    ],
  });
  await h.post(paymentEvent('e1', 'payment.updated', { id: 'pay-open', status: 'CANCELED', referenceId: 'open' }));
  await h.post(paymentEvent('e2', 'payment.updated', { id: 'pay-closed', status: 'CANCELED', referenceId: 'closed' }));
  await h.post(paymentEvent('e3', 'payment.updated', { id: 'pay-orphan', status: 'CANCELED', referenceId: 'orphan' }));
  await h.post(paymentEvent('e4', 'payment.updated', { id: 'pay-late', status: 'FAILED', referenceId: 'unknown' }));
  assert.deepEqual([h.attempt('open').status, h.attempt('open').lastError], ['EXPIRED', OPERATIONS_MESSAGES.PAYMENT_HOLD_CANCELLED]);
  assert.deepEqual([h.attempt('closed').status, h.attempt('closed').lastError], ['VOIDED', null]);
  assert.deepEqual([h.attempt('orphan').status, h.attempt('orphan').lastError], ['VOIDED', OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED]);
  // An authorization nobody heard back about, now known: declined, and its id learnt.
  assert.deepEqual([h.attempt('unknown').status, h.attempt('unknown').lastError, h.attempt('unknown').squarePaymentId], ['FAILED', OPERATIONS_MESSAGES.PAYMENT_DECLINED, 'pay-late']);
  assert.ok(h.tables.squareWebhookEvent.every((event) => event.processedAt), 'all four matched');
  assert.deepEqual(h.square.calls.order, []);
});

at('a notice for another Square environment, a different amount or an unknown reference is kept unmatched', async () => {
  const h = harness({
    attempts: [
      // A production deposit in a preview database (a copy of production).
      attempt({ id: 'prod', environment: 'production', status: 'CAPTURE_UNKNOWN' }),
      attempt({ id: 'amount', status: 'CAPTURE_UNKNOWN' }),
    ],
  });
  await h.post(paymentEvent('e-env', 'payment.updated', { id: 'pay-prod', status: 'COMPLETED', referenceId: 'prod' }));
  await h.post(paymentEvent('e-amt', 'payment.updated', { id: 'pay-amount', status: 'COMPLETED', referenceId: 'amount', amount: 1999 }));
  const unknown = await h.post(paymentEvent('e-unk', 'payment.created', { id: 'pay-nobody', status: 'APPROVED', referenceId: 'cnobody0000000000000000000' }));
  assert.equal(unknown.status, 200);
  assert.equal(h.attempt('prod').status, 'CAPTURE_UNKNOWN');
  assert.equal(h.attempt('amount').status, 'CAPTURE_UNKNOWN');
  assert.deepEqual(h.tables.squareWebhookEvent.map((event) => [event.eventId, event.processedAt]), [['e-env', null], ['e-amt', null], ['e-unk', null]]);
  assert.equal(h.writes('paymentAttempt'), 0);
});

at('Square holding money no booking wants is released AFTER the answer, on a fresh read', async () => {
  const h = harness({
    appointments: [booking('closed', 'CANCELLED'), booking('open', 'PENDING')],
    attempts: [
      // Square never answered; the authorization landed later.
      attempt({ id: 'gave-up', status: 'UNKNOWN', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_OUTCOME_UNKNOWN }),
      // Cancelled by its key ({} even though nothing had landed yet).
      attempt({ id: 'by-key', status: 'VOIDED', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED }),
      // A declined request whose release failed.
      attempt({ id: 'closed', appointmentId: 'closed', lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED }),
      // A hold its request still needs.
      attempt({ id: 'open', appointmentId: 'open' }),
      // Authorized seconds ago: its submission is linking it to the new booking right now.
      attempt({ id: 'linking', createdAt: minutes(-1), updatedAt: minutes(-1) }),
    ],
  });
  for (const id of ['gave-up', 'by-key', 'closed', 'open', 'linking']) h.square.hold(`pay-${id}`, id);
  for (const id of ['gave-up', 'by-key', 'closed', 'open', 'linking']) {
    const response = await h.post(paymentEvent(`evt-${id}`, 'payment.created', { id: `pay-${id}`, status: 'APPROVED', referenceId: id }));
    assert.equal(response.status, 200);
  }
  assert.deepEqual(h.square.calls.order, [], 'nothing is asked of Square before the answer has gone');
  assert.equal(h.deferred.length, 3, 'one fresh check per event that needs one');
  assert.equal(h.attempt('gave-up').squarePaymentId, 'pay-gave-up', 'its Square id is learnt at once');
  await h.runAfter();
  assert.deepEqual(h.square.calls.cancel.sort(), ['pay-by-key', 'pay-closed', 'pay-gave-up']);
  assert.deepEqual([h.attempt('gave-up').status, h.attempt('gave-up').lastError], ['VOIDED', OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED]);
  assert.deepEqual([h.attempt('by-key').status, h.attempt('by-key').lastError, h.attempt('by-key').squarePaymentId], ['VOIDED', OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED, 'pay-by-key']);
  assert.deepEqual([h.attempt('closed').status, h.attempt('closed').lastError], ['VOIDED', null]);
  assert.equal(h.attempt('open').status, 'AUTHORIZED');
  assert.equal(h.attempt('linking').status, 'AUTHORIZED', 'never released from under its own submission');
  assert.equal(h.square.payments.get('pay-open')?.status, 'APPROVED');
  assert.equal(h.square.payments.get('pay-linking')?.status, 'APPROVED');
  assert.ok(h.tables.squareWebhookEvent.every((event) => event.processedAt), 'every event settled');
});

at('a release that fails after the answer leaves the event open for the daily run', async () => {
  const h = harness({ appointments: [booking('closed', 'CANCELLED')], attempts: [attempt({ id: 'closed', appointmentId: 'closed' })] });
  h.square.hold('pay-closed', 'closed');
  h.square.script.cancel = async () => { throw new (await import('../../../services/square-gateway')).SquareGatewayError('unknown_outcome'); };
  await h.post(paymentEvent('evt', 'payment.updated', { id: 'pay-closed', status: 'APPROVED', referenceId: 'closed' }));
  await h.runAfter();
  assert.deepEqual([h.attempt('closed').status, h.attempt('closed').lastError], ['AUTHORIZED', OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED]);
  assert.equal(h.event('evt')?.processedAt, null);
});

at('Square taking a deposit after its booking closed: a fresh read, then a full refund (LATE_CAPTURE)', async () => {
  const h = harness({
    appointments: [booking('declined', 'CANCELLED')],
    // The decline settled the unanswered capture as "still held" and planned a
    // release; the capture landed at Square a moment later.
    attempts: [attempt({ id: 'late', appointmentId: 'declined', lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED })],
  });
  h.square.hold('pay-late', 'late', 'COMPLETED');
  await h.post(paymentEvent('evt-late', 'payment.updated', { id: 'pay-late', status: 'COMPLETED', referenceId: 'late' }));
  assert.equal(h.attempt('late').status, 'AUTHORIZED', 'the notice alone moves no money');
  await h.runAfter();
  assert.deepEqual(h.square.calls.order.slice(0, 1), ['getPayment:pay-late'], 'Square is read afresh first');
  assert.deepEqual([h.attempt('late').status, h.attempt('late').lastError], ['CAPTURED', OPERATIONS_MESSAGES.PAYMENT_LATE_CAPTURE_REFUNDED]);
  const [late] = h.refunds('late');
  assert.deepEqual([late.reason, late.amountPence, late.status, late.squareRefundId], ['LATE_CAPTURE', 2000, 'PENDING', `sq-refund-${late.idempotencyKey}`]);
  assert.deepEqual(h.tables.audit.map((row) => [row.action, row.metadata.from, row.metadata.depositPence]), [['PAYMENT.LATE_CAPTURE_REFUND', 'AUTHORIZED', 2000]]);
  assert.ok(h.event('evt-late')?.processedAt);
  // Delivered again: nothing more.
  await h.post(paymentEvent('evt-late', 'payment.updated', { id: 'pay-late', status: 'COMPLETED', referenceId: 'late' }));
  await h.runAfter();
  assert.equal(h.refunds('late').length, 1, 'never refunded twice');
});

// Review I-D: taken at Square while this site still records a hold, on a
// request still open — recorded taken (and flagged) after a fresh read, so a
// decline refunds it at once; the booking itself never changes here.
at('Square taking a deposit this site still holds for an open request: recorded taken after the answer, on a fresh read', async () => {
  const h = harness({ appointments: [booking('open', 'PENDING')], attempts: [attempt({ id: 'open', appointmentId: 'open' })] });
  h.square.hold('pay-open', 'open', 'COMPLETED');
  await h.post(paymentEvent('evt-open', 'payment.updated', { id: 'pay-open', status: 'COMPLETED', referenceId: 'open' }));
  assert.equal(h.attempt('open').status, 'AUTHORIZED', 'the notice alone moves nothing');
  await h.runAfter();
  assert.deepEqual(h.square.calls.order, ['getPayment:pay-open']);
  assert.deepEqual([h.attempt('open').status, h.attempt('open').lastError], ['CAPTURED', OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED]);
  assert.deepEqual([h.refunds('open'), h.tables.appointment[0].status], [[], 'PENDING']);
  assert.ok(h.event('evt-open')?.processedAt);
});

at('refund notices move refunds forward only, and find a refund that never heard back', async () => {
  const h = harness({
    appointments: [booking('a', 'CANCELLED'), booking('b', 'CANCELLED'), booking('c', 'CANCELLED')],
    attempts: [
      attempt({ id: 'a', appointmentId: 'a', status: 'CAPTURED' }),
      attempt({ id: 'b', appointmentId: 'b', status: 'CAPTURED' }),
      attempt({ id: 'c', appointmentId: 'c', status: 'CAPTURED', amountPence: 4000 }),
    ],
    refunds: [
      refund({ id: 'ra', attemptId: 'a', status: 'PENDING', squareRefundId: 'sq-ra' }),
      // Sent, but Square's answer was lost: no Square id yet.
      refund({ id: 'rb', attemptId: 'b', status: 'UNKNOWN' }),
      // Two unanswered refunds of the same amount: which one Square means cannot be told.
      refund({ id: 'rc1', attemptId: 'c', status: 'REQUESTED' }),
      refund({ id: 'rc2', attemptId: 'c', status: 'REQUESTED' }),
    ],
  });
  await h.post(refundEvent('r1', 'refund.updated', { id: 'sq-ra', status: 'COMPLETED', paymentId: 'pay-a' }));
  await h.post(refundEvent('r0', 'refund.created', { id: 'sq-ra', status: 'PENDING', paymentId: 'pay-a' }));
  await h.post(refundEvent('r2', 'refund.created', { id: 'sq-rb', status: 'PENDING', paymentId: 'pay-b' }));
  await h.post(refundEvent('r3', 'refund.created', { id: 'sq-rc', status: 'PENDING', paymentId: 'pay-c' }));
  assert.equal(h.tables.paymentRefund.find((row) => row.id === 'ra')?.status, 'COMPLETED', 'an older PENDING never undoes COMPLETED');
  assert.deepEqual((({ status, squareRefundId }) => ({ status, squareRefundId }))(h.tables.paymentRefund.find((row) => row.id === 'rb')!), { status: 'PENDING', squareRefundId: 'sq-rb' });
  assert.deepEqual(h.refunds('c').map((row) => [row.status, row.squareRefundId]), [['REQUESTED', null], ['REQUESTED', null]]);
  assert.deepEqual(h.tables.squareWebhookEvent.map((event) => [event.eventId, Boolean(event.processedAt)]), [['r1', true], ['r0', true], ['r2', true], ['r3', false]]);
  assert.equal(h.tables.appointment.every((row) => row.status === 'CANCELLED'), true);
});

// Review W-B: a refund made on the salon's card reader at this location has no
// deposit reference to drop it by before the database, so it is looked up once
// — and, its payment being none of this site's deposits, settled there and
// then: never listed as unmatched, never raised in the daily email, never
// re-read by the daily run for a week.
at('a refund of a payment that is not one of our deposits (an in-salon refund) is settled at once: no alert, no daily re-reads', async () => {
  const h = harness({ appointments: [booking('a', 'CANCELLED')], attempts: [attempt({ id: 'a', appointmentId: 'a', status: 'CAPTURED' })] });
  for (const [eventId, type, status] of [['evt-counter-1', 'refund.created', 'PENDING'], ['evt-counter-2', 'refund.updated', 'COMPLETED']] as const) {
    assert.equal((await h.post(refundEvent(eventId, type, { id: 'r-counter', status, paymentId: 'pay-counter-sale' }))).status, 200);
    assert.deepEqual(h.event(eventId), { eventId, type, objectId: 'r-counter', receivedAt: NOW, processedAt: NOW }, 'stored once, settled');
  }
  assert.equal(h.writes('paymentRefund') + h.writes('paymentAttempt'), 0, 'nothing of ours changes');
  assert.equal(h.deferred.length, 0, 'Square is not asked about it');
  const { collectPaymentAttention, pageWindows } = await import('../../../services/payment-attention');
  const later = minutes(3 * 60);
  assert.deepEqual((await collectPaymentAttention(h.db as never, later, pageWindows(later))).notifications, [], 'not in the attention list or the email');
  const reads = h.calls.length;
  const reconciliation = createPaymentReconciliation({ db: h.db as never, config: CONFIG, gatewayFor: () => h.square.gateway as never, now: () => later });
  assert.equal((await reconciliation.reconcileAll()).checked, 0, 'the daily run has nothing to re-read');
  assert.ok(!h.calls.slice(reads).some((call) => call.model === 'paymentRefund' && call.method === 'findUnique'), 'no daily look-up of it');
});

at('a refund of one of our deposits that no refund row matches (made in the Square Dashboard) stays open and listed', async () => {
  const h = harness({ appointments: [booking('a', 'CANCELLED')], attempts: [attempt({ id: 'a', appointmentId: 'a', status: 'CAPTURED' })] });
  assert.equal((await h.post(refundEvent('evt-dashboard', 'refund.created', { id: 'r-dashboard', status: 'PENDING', paymentId: 'pay-a' }))).status, 200);
  assert.equal(h.event('evt-dashboard')?.processedAt, null, 'ours, but nothing here asked for it: staff look');
  const { collectPaymentAttention, pageWindows } = await import('../../../services/payment-attention');
  const later = minutes(3 * 60);
  assert.deepEqual((await collectPaymentAttention(h.db as never, later, pageWindows(later))).notifications.map((row) => row.eventId), ['evt-dashboard']);
});

// Review W-C: retries stop after 7 days (UNRESOLVED), but Square's own word on
// that refund still counts; one staff settled outside the website is final, so
// Square refunding it too is shown to staff, never recorded over it.
at('a refund the website stopped retrying still moves forward on Square\'s notice; one settled outside the website stays listed instead', async () => {
  const h = harness({
    appointments: [booking('a', 'CANCELLED'), booking('b', 'CANCELLED')],
    attempts: [attempt({ id: 'a', appointmentId: 'a', status: 'CAPTURED' }), attempt({ id: 'b', appointmentId: 'b', status: 'CAPTURED' })],
    refunds: [
      refund({ id: 'ra', attemptId: 'a', status: 'UNRESOLVED' }),
      refund({ id: 'rb', attemptId: 'b', status: 'SETTLED_EXTERNALLY' }),
    ],
  });
  await h.post(refundEvent('evt-ra', 'refund.updated', { id: 'sq-ra', status: 'COMPLETED', paymentId: 'pay-a' }));
  assert.deepEqual((({ status, squareRefundId }) => ({ status, squareRefundId }))(h.tables.paymentRefund.find((row) => row.id === 'ra')!), { status: 'COMPLETED', squareRefundId: 'sq-ra' });
  assert.ok(h.event('evt-ra')?.processedAt);
  await h.post(refundEvent('evt-rb', 'refund.updated', { id: 'sq-rb', status: 'COMPLETED', paymentId: 'pay-b' }));
  assert.deepEqual((({ status, squareRefundId }) => ({ status, squareRefundId }))(h.tables.paymentRefund.find((row) => row.id === 'rb')!), { status: 'SETTLED_EXTERNALLY', squareRefundId: null });
  assert.equal(h.event('evt-rb')?.processedAt, null, 'refunded twice? staff see the notice');
});

at('a refund notice that arrives before its sender has recorded Square\'s answer (SUBMITTING) is matched and moves it forward', async () => {
  const h = harness({
    appointments: [booking('d', 'CANCELLED')],
    attempts: [attempt({ id: 'd', appointmentId: 'd', status: 'CAPTURED' })],
    refunds: [refund({ id: 'rd', attemptId: 'd', status: 'SUBMITTING', updatedAt: minutes(-1) })],
  });
  await h.post(refundEvent('r-d', 'refund.created', { id: 'sq-rd', status: 'PENDING', paymentId: 'pay-d' }));
  assert.deepEqual((({ status, squareRefundId }) => ({ status, squareRefundId }))(h.tables.paymentRefund.find((row) => row.id === 'rd')!), { status: 'PENDING', squareRefundId: 'sq-rd' });
  assert.ok(h.event('r-d')?.processedAt);
});

at('a database failure answers 500 so Square delivers again, and the retry finishes the job', async (t) => {
  t.mock.method(console, 'error', () => {});
  const h = harness({ appointments: [booking('p', 'PENDING')], attempts: [attempt({ id: 'u', appointmentId: 'p', status: 'CAPTURE_UNKNOWN' })] });
  const body = paymentEvent('evt-retry', 'payment.updated', { id: 'pay-u', status: 'COMPLETED', referenceId: 'u' });
  h.faults.push({ model: 'squareWebhookEvent', method: 'create', error: new Error('connection lost'), times: 1 });
  assert.equal((await h.post(body)).status, 500);
  assert.equal(h.tables.squareWebhookEvent.length, 0);
  // Stored, then the attempt could not be read: open, and 500 again.
  h.faults.push({ model: 'paymentAttempt', method: 'findUnique', error: new Error('connection lost'), times: 1 });
  assert.equal((await h.post(body)).status, 500);
  assert.equal(h.event('evt-retry')?.processedAt, null);
  assert.equal(h.attempt('u').status, 'CAPTURE_UNKNOWN');
  // Square's next try: already stored but never finished, so it is applied now.
  assert.equal((await h.post(body)).status, 200);
  assert.equal(h.attempt('u').status, 'CAPTURED');
  assert.ok(h.event('evt-retry')?.processedAt);
});
