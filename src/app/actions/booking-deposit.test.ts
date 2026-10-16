import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { bookingFixture as fixture, approvedPayment, SANDBOX_SQUARE_ENV, type AttemptRow } from '../../test/booking-fixture';
import { ANY_STYLIST_ID } from '../lib/booking-constants';
import { resolveSalonDateTime } from '../services/salon-time';
import { SquareGatewayError } from '../services/square-gateway';
import { OPERATIONS_MESSAGES } from '../services/operations-messages';
import { translator } from '../../i18n/messages';

/**
 * A booking request that owes a card deposit (phase S2 of
 * docs/superpowers/specs/2026-10-13-square-deposits-design.md): Square HOLDS
 * the deposit when the request is made, the hold is tied to the appointment in
 * the booking transaction, and every refusal that can be known beforehand is
 * made before any money moves. Driven through the real action and booking
 * service over the stateful fake database, with a fake Square gateway.
 */

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

const TUESDAY = '2026-10-06';
const START = resolveSalonDateTime(TUESDAY, '11:00').utc;
const KEY = '3b241101-e2bb-4255-8caf-4136c566a962';
const OTHER_KEY = '9f6c2a4e-1d3b-4c5a-8e7f-0a1b2c3d4e5f';
const THIRD_KEY = '6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b';
/** 20% of the £100.00 fixture service. */
const DEPOSITS = { depositsEnabled: true, depositPercent: 20, depositMinimumServicePence: 0 };
const errorText = (code: string) => translator('en-GB', 'errors').dynamic(`booking.${code}`);

const request = (overrides: Record<string, unknown> = {}) => ({
  stylistId: 'funky', serviceId: 'service-1', date: TUESDAY, time: '11:00',
  expectedQuote: { serviceId: 'service-1', priceVersion: 1, amountPence: 10000 },
  expectedDepositPence: 2000, paymentToken: 'cnon:card-nonce-ok', attemptKey: KEY,
  ...overrides,
});

/** Another customer's booking with Funky at the requested time. */
const rivalBooking = () => ({ id: 'rival', userId: 'user-2', serviceId: 'service-1', stylistId: 'funky', date: START, status: 'PENDING', durationAtBooking: 60, notificationVersion: 0 });

const deposited = (options: Parameters<typeof fixture>[0] = {}) => fixture({ deposits: DEPOSITS, ...options });

async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const errors = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = errors;
  }
}

test('no deposit due: the request books exactly as before, and payment fields are ignored', async () => {
  for (const f of [fixture(), fixture({ deposits: { ...DEPOSITS, depositsEnabled: false } })]) {
    assert.deepEqual(await f.actions.submitBooking(request()), { success: true });
    assert.equal(f.rows.length, 1);
    assert.deepEqual(f.attempts, [], 'no payment attempt');
    assert.deepEqual(f.squareCalls.authorize, [], 'Square is never asked');
    assert.deepEqual(f.notices, ['appointment-1/REQUEST_RECEIVED', 'appointment-1/SALON_ALERT']);
    assert.deepEqual(f.queuedDeposits.map((notice) => notice.paymentAttempt), [null, null]);
  }
  // A service the salon exempts (override 0) owes nothing even with deposits on.
  const exempt = deposited();
  exempt.liveService.depositOverridePence = 0;
  assert.deepEqual(await exempt.actions.submitBooking(request({ expectedDepositPence: undefined, paymentToken: undefined, attemptKey: undefined })), { success: true });
  assert.deepEqual(exempt.squareCalls.authorize, []);
});

for (const stylistId of ['funky', ANY_STYLIST_ID]) {
  test(`a deposit is authorized for the server's amount and tied to the new request (${stylistId === ANY_STYLIST_ID ? 'Anyone' : 'named stylist'})`, async () => {
    const f = deposited();
    assert.deepEqual(await f.actions.submitBooking(request({ stylistId })), { success: true, depositHeldPence: 2000 });

    assert.equal(f.rows.length, 1);
    const [attempt] = f.attempts;
    assert.equal(f.attempts.length, 1);
    assert.equal(attempt.status, 'AUTHORIZED');
    assert.equal(attempt.appointmentId, 'appointment-1', 'linked in the booking transaction');
    assert.equal(attempt.userId, 'user-1');
    assert.equal(attempt.amountPence, 2000);
    assert.equal(attempt.quoteAmountPence, 10000);
    assert.equal(attempt.environment, 'sandbox');
    assert.equal(attempt.locationId, 'fixture-location');
    assert.equal(attempt.idempotencyKey, 'dep_3b241101e2bb42558caf4136c566a962');
    assert.equal(attempt.squarePaymentId, `payment-for-${attempt.id}`);
    assert.ok(attempt.authorizedAt instanceof Date && attempt.delayedUntil instanceof Date);
    assert.equal(attempt.lastError, null);
    assert.deepEqual(JSON.parse(attempt.requestJson), { serviceId: 'service-1', stylist: stylistId, start: START.toISOString() });
    assert.deepEqual(JSON.parse(attempt.policyJson), { enabled: true, percent: 20, minimumServicePence: 0, overridePence: null });

    assert.deepEqual(f.squareCalls.authorize, [{
      sourceId: 'cnon:card-nonce-ok', amountPence: 2000, idempotencyKey: 'dep_3b241101e2bb42558caf4136c566a962', referenceId: attempt.id,
      note: 'Booking deposit: Cut on 2026-10-06 at 11:00 (salon time)',
    }]);
    assert.doesNotMatch(f.squareCalls.authorize[0].note!, /Customer|@|user-1/, 'no personal data in the note');
    // Money moves with the deployment's usable (sandbox) configuration.
    const config = await f.squareCalls.configs[0]() as { environment: string; locationId: string };
    assert.deepEqual([config.environment, config.locationId], ['sandbox', 'fixture-location']);

    assert.deepEqual(f.notices, ['appointment-1/REQUEST_RECEIVED', 'appointment-1/SALON_ALERT'], 'one receipt, one salon alert');
    assert.deepEqual(f.queuedDeposits.find((notice) => notice.kind === 'REQUEST_RECEIVED')?.paymentAttempt, { status: 'AUTHORIZED', amountPence: 2000 }, 'the receipt mentions the hold');
    assert.equal(f.effects.feedInvalidations, 1);
    assert.equal(f.effects.dispatches, 1);
    assert.deepEqual(f.squareCalls.cancel, [], 'nothing released');
  });
}

test('the same submission again (its answer was lost) replays the outcome: no second authorization', async () => {
  const f = deposited();
  assert.deepEqual(await f.actions.submitBooking(request()), { success: true, depositHeldPence: 2000 });
  // Already requested, and the hold this same submission placed.
  const replayed = { success: true, alreadyRequested: true, depositHeldPence: 2000 };
  assert.deepEqual(await f.actions.submitBooking(request()), replayed, 'the replay reports the same hold');
  // The key is one spelling whatever case the page used.
  assert.deepEqual(await f.actions.submitBooking(request({ attemptKey: KEY.toUpperCase() })), replayed);
  assert.equal(f.squareCalls.authorize.length, 1);
  assert.equal(f.attempts.length, 1);
  assert.equal(f.rows.length, 1);
  assert.equal(f.notices.length, 2, 'nothing new is queued');
  // The lost answer may have taken the feed refresh and delivery with it: a
  // replay runs both again (both idempotent), like any repeat.
  assert.equal(f.effects.feedInvalidations, 3);
  assert.deepEqual(f.effects.dispatchedFor, ['appointment-1', 'appointment-1', 'appointment-1']);
});

test('two copies of one submission at once: one authorization, one booking', async () => {
  const f = deposited();
  const answers = await Promise.all([f.actions.submitBooking(request()), f.actions.submitBooking(request())]);
  assert.equal(f.squareCalls.authorize.length, 1, 'the attempt key is unique per customer: the loser replays it');
  assert.equal(f.attempts.length, 1);
  assert.equal(f.rows.length, 1);
  assert.deepEqual(answers[0], { success: true, depositHeldPence: 2000 });
  // The second copy either saw the booking made or was told to wait for it.
  assert.ok(answers[1].success || answers[1].code === 'PAYMENT_PENDING', JSON.stringify(answers[1]));
});

test('a replayed declined card is declined again without asking Square twice', async () => {
  const f = deposited({ square: { authorize: async () => { throw new SquareGatewayError('provider_error', 402); } } });
  const first = await f.actions.submitBooking(request());
  const again = await f.actions.submitBooking(request());
  for (const answer of [first, again]) assert.deepEqual(answer, { success: false, code: 'CARD_DECLINED', error: errorText('CARD_DECLINED') });
  assert.equal(f.squareCalls.authorize.length, 1);
});

test('a replay while the first submission is still with Square says to wait, and authorizes nothing', async () => {
  const f = deposited();
  // What the first submission left behind before Square answered.
  f.attempts.push({
    id: 'inflight', userId: 'user-1', attemptKey: KEY, idempotencyKey: 'dep_3b241101e2bb42558caf4136c566a962', appointmentId: null, status: 'INITIATED',
    environment: 'sandbox', locationId: 'fixture-location', amountPence: 2000, currency: 'GBP', quoteAmountPence: 10000, policyJson: '{}',
    requestJson: JSON.stringify({ serviceId: 'service-1', stylist: 'funky', start: START.toISOString() }), squarePaymentId: null,
    delayedUntil: null, authorizedAt: null, capturedAt: null, voidedAt: null, lastError: null,
  } satisfies AttemptRow);
  const answer = await f.actions.submitBooking(request());
  assert.equal(!answer.success && answer.code, 'PAYMENT_PENDING');
  assert.deepEqual(f.squareCalls.authorize, []);
  assert.equal(f.rows.length, 0);
  // The same key sent for a different request is refused, not answered for it.
  const other = await f.actions.submitBooking(request({ time: '14:00' }));
  assert.equal(!other.success && other.code, 'INVALID_BOOKING');
  assert.deepEqual(f.squareCalls.authorize, []);
});

test('the same request with a new card token is the request already made: success and no charge', async () => {
  const f = deposited();
  assert.deepEqual(await f.actions.submitBooking(request()), { success: true, depositHeldPence: 2000 });
  assert.deepEqual(await f.actions.submitBooking(request({ attemptKey: OTHER_KEY, paymentToken: 'cnon:second-token' })), { success: true, alreadyRequested: true }, 'no new hold to report');
  assert.equal(f.squareCalls.authorize.length, 1, 'the second token is never used');
  assert.equal(f.attempts.length, 1, 'no attempt for the repeat');
  assert.equal(f.rows.length, 1);
  assert.equal(f.notices.length, 2);
  assert.equal(f.effects.feedInvalidations, 2, 'a repeat still refreshes the feed');
  assert.deepEqual(f.effects.dispatchedFor, ['appointment-1', 'appointment-1'], 'and delivers what is still queued');
});

test('before the card, a repeat is what the booking transaction calls one: the named stylist, or any for "Anyone"', async () => {
  const f = deposited();
  assert.deepEqual(await f.actions.submitBooking(request()), { success: true, depositHeldPence: 2000 });
  // The same time with another named stylist is a deliberate second booking, with its own hold.
  assert.deepEqual(await f.actions.submitBooking(request({ stylistId: 'lox', attemptKey: OTHER_KEY, paymentToken: 'cnon:second-token' })), { success: true, depositHeldPence: 2000 });
  assert.deepEqual(f.rows.map((row) => row.stylistId), ['funky', 'lox']);
  assert.equal(f.squareCalls.authorize.length, 2);
  // "Anyone" at that time is a request already made, whichever stylist has it: the card is never authorized.
  assert.deepEqual(await f.actions.submitBooking(request({ stylistId: ANY_STYLIST_ID, attemptKey: THIRD_KEY, paymentToken: 'cnon:third-token' })), { success: true, alreadyRequested: true });
  assert.equal(f.squareCalls.authorize.length, 2);
  assert.equal(f.attempts.length, 2);
  assert.equal(f.rows.length, 2);
});

test('a time already taken is refused before any money moves', async () => {
  const named = deposited();
  named.rows.push(rivalBooking());
  const answer = await named.actions.submitBooking(request());
  assert.equal(!answer.success && answer.code, 'SLOT_UNAVAILABLE');
  assert.deepEqual(named.attempts, []);
  assert.deepEqual(named.squareCalls.authorize, []);

  const anyone = deposited();
  anyone.rows.push(rivalBooking(), { ...rivalBooking(), id: 'rival-2', stylistId: 'lox' });
  const full = await anyone.actions.submitBooking(request({ stylistId: ANY_STYLIST_ID }));
  assert.equal(!full.success && full.code, 'NO_STYLIST_AT_TIME');
  assert.deepEqual(anyone.squareCalls.authorize, []);
});

test('booking closing before the card is charged refuses without authorizing', async () => {
  const f = deposited({ ready: false });
  const answer = await f.actions.submitBooking(request());
  assert.equal(!answer.success && answer.code, 'MAINTENANCE');
  assert.deepEqual(f.squareCalls.authorize, []);
  assert.deepEqual(f.attempts, []);
});

test('a price changed since the page loaded is answered with the new price before any money moves', async () => {
  const f = deposited();
  const answer = await f.actions.submitBooking(request({ expectedQuote: { serviceId: 'service-1', priceVersion: 0, amountPence: 9000 } }));
  assert.equal(answer.success, false);
  assert.equal(!answer.success && answer.code, 'PRICE_CHANGED');
  assert.equal(!answer.success && answer.quote?.amountPence, 10000);
  assert.deepEqual(f.squareCalls.authorize, []);
});

test('the time lost inside the booking transaction: the hold is released and the customer told the time went', async () => {
  let raced = false;
  const f = deposited({ onTransaction: (rows) => { if (!raced) { raced = true; rows.push(rivalBooking()); } } });
  const answer = await quietly(() => f.actions.submitBooking(request()));
  assert.deepEqual(answer, { success: false, code: 'SLOT_UNAVAILABLE', error: errorText('SLOT_UNAVAILABLE') });
  assert.equal(f.squareCalls.authorize.length, 1, 'the hold was taken first');
  const [attempt] = f.attempts;
  assert.deepEqual(f.squareCalls.cancel, [{ paymentId: attempt.squarePaymentId, amountPence: 2000, referenceId: attempt.id }]);
  assert.equal(attempt.status, 'VOIDED');
  assert.ok(attempt.voidedAt instanceof Date);
  assert.equal(attempt.lastError, OPERATIONS_MESSAGES.PAYMENT_RELEASED_NOT_BOOKED);
  assert.equal(attempt.appointmentId, null);
  assert.deepEqual(f.rows.map((row) => row.id), ['rival']);
  assert.deepEqual(f.notices, []);
  // Its answer replays as the lost time, not a new hold.
  const again = await f.actions.submitBooking(request());
  assert.equal(!again.success && again.code, 'SLOT_UNAVAILABLE');
  assert.equal(f.squareCalls.authorize.length, 1);
});

// Money-safety review I3: an error from the booking transaction that is not a
// refusal may come after its COMMIT (the answer lost on the way back). The
// hold was released on any error, leaving a live request tied to a released
// hold — which can never be confirmed.
test('the booking committed but its answer was lost: answered as booked, and its hold is kept', async () => {
  const f = deposited({ commitAnswerLost: true });
  const answer = await quietly(() => f.actions.submitBooking(request()));
  assert.deepEqual(answer, { success: true, depositHeldPence: 2000 });
  assert.equal(f.rows.length, 1);
  const [attempt] = f.attempts;
  assert.deepEqual([attempt.status, attempt.appointmentId, attempt.lastError], ['AUTHORIZED', 'appointment-1', null]);
  assert.deepEqual(f.squareCalls.cancel, [], 'never released from under its request');
  // Announced like any new request: the busy feed and the queued receipt.
  assert.equal(f.effects.feedInvalidations, 1);
  assert.deepEqual(f.effects.dispatchedFor, ['appointment-1']);
  // The same submission again finds it booked.
  assert.deepEqual(await f.actions.submitBooking(request()), { success: true, alreadyRequested: true, depositHeldPence: 2000 });
  assert.equal(f.squareCalls.authorize.length, 1);
});

test('an unclear failure with nothing committed still releases the hold at once', async () => {
  let failed = false;
  const f = deposited({ onTransaction: () => { if (!failed) { failed = true; throw new Error('Connection reset before the booking was written'); } } });
  const answer = await quietly(() => f.actions.submitBooking(request()));
  assert.equal(!answer.success && answer.code, 'BOOKING_FAILED');
  const [attempt] = f.attempts;
  assert.deepEqual([attempt.status, attempt.appointmentId, attempt.lastError], ['VOIDED', null, OPERATIONS_MESSAGES.PAYMENT_RELEASED_NOT_BOOKED]);
  assert.equal(f.squareCalls.cancel.length, 1);
  assert.deepEqual(f.rows, []);
});

test('when even the re-read fails nobody can tell whether it was booked: the hold is left alone and the customer told to check', async () => {
  const f = deposited({ commitAnswerLost: true, onAttemptReadById: () => { throw new Error('database unavailable'); } });
  const answer = await quietly(() => f.actions.submitBooking(request()));
  assert.deepEqual(answer, { success: false, code: 'PAYMENT_PENDING', error: errorText('PAYMENT_PENDING') });
  assert.match(errorText('PAYMENT_PENDING'), /My Bookings/);
  assert.deepEqual([f.attempts[0].status, f.squareCalls.cancel], ['AUTHORIZED', []], 'reconciliation releases it if nothing was booked');
});

// Money-safety review I4: card testing through a verified account was only
// limited by bookingLimiter (6 an hour). Declines now have a budget of their
// own: 3 per account and 5 per address a day, checked before an attempt is
// written or Square is asked.
const keyNumber = (n: number) => `${n.toString(16).padStart(8, '0')}-1d3b-4c5a-8e7f-0a1b2c3d4e5f`;
const declining = { authorize: async () => { throw new SquareGatewayError('provider_error', 402); } };

test('card testing: after 3 declines on one account in a day, more card attempts are refused before Square is asked', async () => {
  let decline = true;
  const f = deposited({ square: { authorize: async (input) => { if (decline) throw new SquareGatewayError('provider_error', 402); return approvedPayment(input); } } });
  for (let n = 1; n <= 3; n++) {
    const answer = await f.actions.submitBooking(request({ attemptKey: keyNumber(n), paymentToken: `cnon:card-${n}` }));
    assert.equal(!answer.success && answer.code, 'CARD_DECLINED', `card ${n}`);
  }
  decline = false;
  const refused = await f.actions.submitBooking(request({ attemptKey: keyNumber(4), paymentToken: 'cnon:card-4' }));
  assert.deepEqual(refused, { success: false, code: 'PAYMENT_UNAVAILABLE', error: errorText('PAYMENT_UNAVAILABLE') });
  assert.equal(f.squareCalls.authorize.length, 3, 'even a good fourth card never reaches Square');
  assert.equal(f.attempts.length, 3, 'and no attempt is written for it');
  // The account's budget follows it to another address.
  f.asCustomer('user-1', '198.51.100.9');
  const moved = await f.actions.submitBooking(request({ attemptKey: keyNumber(5), paymentToken: 'cnon:card-5' }));
  assert.equal(!moved.success && moved.code, 'PAYMENT_UNAVAILABLE');
  // A replay of an earlier submission is still answered as it was, without asking Square.
  const replayed = await f.actions.submitBooking(request({ attemptKey: keyNumber(1), paymentToken: 'cnon:card-1' }));
  assert.equal(!replayed.success && replayed.code, 'CARD_DECLINED');
  // Another account at that address is unaffected.
  f.asCustomer('user-2', '198.51.100.9');
  assert.deepEqual(await f.actions.submitBooking(request({ attemptKey: keyNumber(6), paymentToken: 'cnon:card-6' })), { success: true, depositHeldPence: 2000 });
  assert.equal(f.squareCalls.authorize.length, 4);
});

test('card testing across accounts: after 5 declines from one address in a day, that address is refused', async () => {
  const f = deposited({ square: declining });
  for (let n = 1; n <= 5; n++) {
    f.asCustomer(`user-${n}`);
    const answer = await f.actions.submitBooking(request({ attemptKey: keyNumber(n), paymentToken: `cnon:card-${n}` }));
    assert.equal(!answer.success && answer.code, 'CARD_DECLINED', `account ${n}`);
  }
  f.asCustomer('user-6');
  const refused = await f.actions.submitBooking(request({ attemptKey: keyNumber(6), paymentToken: 'cnon:card-6' }));
  assert.equal(!refused.success && refused.code, 'PAYMENT_UNAVAILABLE');
  assert.equal(f.squareCalls.authorize.length, 5);
});

// Security review 2026-10-16: the decline budgets are read before Square is
// asked and counted only after it answers, so submissions sent together all
// passed them. One address's authorizations are spent first, atomically.
test('card testing: one address gets at most 20 card authorizations a day, of any outcome', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = deposited({ square: { authorize: async () => { throw new SquareGatewayError('provider_error', 401); } } });
  for (let n = 1; n <= 20; n++) {
    f.asCustomer(`user-${n}`);
    const answer = await f.actions.submitBooking(request({ attemptKey: keyNumber(n), paymentToken: `cnon:card-${n}` }));
    assert.equal(!answer.success && answer.code, 'PAYMENT_UNAVAILABLE', `account ${n}`);
  }
  assert.equal(f.squareCalls.authorize.length, 20);
  f.asCustomer('user-21');
  const refused = await f.actions.submitBooking(request({ attemptKey: keyNumber(21), paymentToken: 'cnon:card-21' }));
  assert.equal(!refused.success && refused.code, 'PAYMENT_UNAVAILABLE');
  assert.equal(f.squareCalls.authorize.length, 20, 'the 21st never reaches Square');
  assert.equal(f.attempts.length, 20, 'and no attempt is written for it');
});

test('card testing in parallel: submissions sent together cannot all slip past the budgets', async () => {
  const f = deposited({ square: declining });
  await Promise.all(Array.from({ length: 30 }, (_, i) => {
    f.asCustomer(`user-${i + 1}`);
    return f.actions.submitBooking(request({ attemptKey: keyNumber(i + 1), paymentToken: `cnon:card-${i + 1}` }));
  }));
  assert.ok(f.squareCalls.authorize.length <= 20, `${f.squareCalls.authorize.length} authorizations reached Square`);
});

test('only declines count: holds that succeed, and payments switched off, never use up the budget', async () => {
  const f = deposited();
  for (let n = 1; n <= 4; n++) {
    const time = `1${n}:00`;
    assert.deepEqual(await f.actions.submitBooking(request({ time, attemptKey: keyNumber(n), paymentToken: `cnon:card-${n}` })), { success: true, depositHeldPence: 2000 }, time);
  }
  const off = deposited({ square: { authorize: async () => { throw new SquareGatewayError('disabled'); } } });
  for (let n = 1; n <= 4; n++) {
    const answer = await off.actions.submitBooking(request({ attemptKey: keyNumber(n), paymentToken: `cnon:card-${n}` }));
    assert.equal(!answer.success && answer.code, 'PAYMENT_UNAVAILABLE');
  }
  assert.equal(off.squareCalls.authorize.length, 4, 'never refused by the decline budget');
});

// Review W-A: a 401 (the website's access token), 403 (its permissions) or
// 404 (its location) is the salon's Square setup, not the customer's card.
// It used to be told "card declined" and used up the decline budget, so after
// three tries a customer (and after five, a whole address) was locked out for
// a day by a configuration fault — and the daily email called it card testing.
test('Square refusing the website’s own setup (401) is not a decline: payment unavailable, and no decline budget is used', async (t) => {
  t.mock.method(console, 'error', () => {});
  let httpStatus = 401;
  const f = deposited({ square: { authorize: async () => { throw new SquareGatewayError('provider_error', httpStatus); } } });
  for (let n = 1; n <= 6; n++) {
    const answer = await f.actions.submitBooking(request({ attemptKey: keyNumber(n), paymentToken: `cnon:card-${n}` }));
    assert.deepEqual(answer, { success: false, code: 'PAYMENT_UNAVAILABLE', error: errorText('PAYMENT_UNAVAILABLE') }, `try ${n}`);
  }
  assert.equal(f.squareCalls.authorize.length, 6, 'never refused by the decline budget: nothing was declined');
  assert.deepEqual(f.attempts.map((row) => [row.status, row.lastError]), Array(6).fill(['FAILED', OPERATIONS_MESSAGES.PAYMENT_SETUP_REFUSED]));
  assert.deepEqual([f.rows, f.notices, f.squareCalls.cancelByIdempotencyKey], [[], [], []]);
  // A replay is answered the same way, without asking Square again.
  const replayed = await f.actions.submitBooking(request({ attemptKey: keyNumber(1), paymentToken: 'cnon:card-1' }));
  assert.equal(!replayed.success && replayed.code, 'PAYMENT_UNAVAILABLE');
  assert.equal(f.squareCalls.authorize.length, 6);
  // Once the setup is fixed, a real decline is still a decline, with the whole budget left.
  httpStatus = 402;
  for (let n = 7; n <= 9; n++) {
    const answer = await f.actions.submitBooking(request({ attemptKey: keyNumber(n), paymentToken: `cnon:card-${n}` }));
    assert.equal(!answer.success && answer.code, 'CARD_DECLINED', `decline ${n}`);
  }
  assert.equal(f.squareCalls.authorize.length, 9);
});

test('when releasing the hold fails it stays AUTHORIZED, marked for reconciliation', async () => {
  let raced = false;
  const f = deposited({
    onTransaction: (rows) => { if (!raced) { raced = true; rows.push(rivalBooking()); } },
    square: { cancel: async () => { throw new SquareGatewayError('unknown_outcome'); } },
  });
  const answer = await quietly(() => f.actions.submitBooking(request()));
  assert.equal(!answer.success && answer.code, 'SLOT_UNAVAILABLE');
  assert.equal(f.attempts[0].status, 'AUTHORIZED');
  assert.equal(f.attempts[0].appointmentId, null);
  assert.equal(f.attempts[0].lastError, OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED);
});

test('a concurrent copy of the request booked first: this second hold is released, and the answer is success', async () => {
  let raced = false;
  const f = deposited({
    onTransaction: (rows) => {
      if (raced) return;
      raced = true;
      rows.push({ ...rivalBooking(), id: 'first-copy', userId: 'user-1' });
    },
  });
  assert.deepEqual(await f.actions.submitBooking(request()), { success: true, alreadyRequested: true }, 'no hold of its own to report');
  const [attempt] = f.attempts;
  assert.equal(attempt.status, 'VOIDED', 'the repeat path never attaches a second deposit');
  assert.equal(attempt.appointmentId, null);
  assert.equal(attempt.lastError, OPERATIONS_MESSAGES.PAYMENT_RELEASED_REPEAT);
  assert.equal(f.squareCalls.cancel.length, 1);
  assert.deepEqual(f.notices, [], 'nothing new is queued');
  // As for any repeat, the booking that stands has its feed refreshed and its queued mail delivered.
  assert.equal(f.effects.feedInvalidations, 1);
  assert.deepEqual(f.effects.dispatchedFor, ['first-copy']);
});

test('a declined card books nothing and records only our own words', async () => {
  const f = deposited({ square: { authorize: async () => { throw new SquareGatewayError('provider_error', 402); } } });
  const answer = await f.actions.submitBooking(request());
  assert.deepEqual(answer, { success: false, code: 'CARD_DECLINED', error: errorText('CARD_DECLINED') });
  assert.match(errorText('CARD_DECLINED'), /Nothing was booked and you have not been charged/);
  assert.equal(f.attempts[0].status, 'FAILED');
  assert.equal(f.attempts[0].lastError, OPERATIONS_MESSAGES.PAYMENT_DECLINED);
  assert.deepEqual(f.rows, []);
  assert.deepEqual(f.notices, []);
  assert.deepEqual(f.squareCalls.cancel, []);
  assert.deepEqual(f.squareCalls.cancelByIdempotencyKey, []);
});

for (const kind of ['unknown_outcome', 'invalid_response'] as const) {
  test(`no usable answer from Square (${kind}): cancelled by the same key, nothing booked`, async () => {
    const f = deposited({ square: { authorize: async () => { throw new SquareGatewayError(kind, kind === 'unknown_outcome' ? 503 : undefined); } } });
    const answer = await f.actions.submitBooking(request());
    assert.deepEqual(answer, { success: false, code: 'PAYMENT_UNCERTAIN', error: errorText('PAYMENT_UNCERTAIN') });
    assert.deepEqual(f.squareCalls.cancelByIdempotencyKey, ['dep_3b241101e2bb42558caf4136c566a962'], 'never a new key for the same submission');
    assert.equal(f.attempts[0].status, 'VOIDED');
    assert.ok(f.attempts[0].voidedAt instanceof Date);
    assert.equal(f.attempts[0].lastError, OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED);
    assert.deepEqual(f.rows, []);
    assert.equal(f.squareCalls.authorize.length, 1);
    // The same submission again gets the same answer, and nothing new.
    assert.deepEqual(await f.actions.submitBooking(request()), answer, 'a replay answers as the first submission was answered');
    assert.equal(f.squareCalls.authorize.length, 1);
  });
}

test('when Square cannot be asked to cancel either, the attempt stays UNKNOWN for reconciliation', async () => {
  const f = deposited({
    square: {
      authorize: async () => { throw new SquareGatewayError('unknown_outcome'); },
      cancelByIdempotencyKey: async () => { throw new SquareGatewayError('unknown_outcome'); },
    },
  });
  const answer = await f.actions.submitBooking(request());
  assert.equal(!answer.success && answer.code, 'PAYMENT_UNCERTAIN');
  assert.equal(f.attempts[0].status, 'UNKNOWN');
  assert.equal(f.attempts[0].lastError, OPERATIONS_MESSAGES.PAYMENT_OUTCOME_UNKNOWN);
  // A replay is told what the first submission was (uncertain), and never
  // authorizes again: reconciliation cancels the attempt by its key.
  const again = await f.actions.submitBooking(request());
  assert.deepEqual(again, { success: false, code: 'PAYMENT_UNCERTAIN', error: errorText('PAYMENT_UNCERTAIN') });
  assert.equal(f.squareCalls.authorize.length, 1);
  assert.equal(f.attempts[0].status, 'UNKNOWN');
});

test('a deposit different from the one the page showed must be reviewed again (QUOTE_CHANGED)', async () => {
  for (const expectedDepositPence of [1500, undefined]) {
    const f = deposited();
    const answer = await f.actions.submitBooking(request({ expectedDepositPence }));
    assert.deepEqual(answer, {
      success: false, code: 'QUOTE_CHANGED', error: errorText('QUOTE_CHANGED'),
      deposit: { amountPence: 10000, depositPence: 2000, remainderPence: 8000 },
    });
    assert.deepEqual(f.attempts, []);
    assert.deepEqual(f.squareCalls.authorize, []);
  }
});

test('a deposit due without a card token or attempt key is refused (PAYMENT_REQUIRED)', async () => {
  for (const missing of [{ paymentToken: undefined }, { attemptKey: undefined }]) {
    const f = deposited();
    const answer = await f.actions.submitBooking(request(missing));
    assert.equal(!answer.success && answer.code, 'PAYMENT_REQUIRED');
    assert.deepEqual(f.squareCalls.authorize, []);
  }
});

test('malformed payment fields are refused as invalid input', async () => {
  for (const bad of [{ attemptKey: 'not-a-uuid' }, { attemptKey: '3b241101-e2bb-1255-8caf-4136c566a962' }, { paymentToken: 'has space' }, { paymentToken: 'x'.repeat(2049) }, { expectedDepositPence: -1 }, { expectedDepositPence: 12.5 }]) {
    const f = deposited();
    const answer = await quietly(() => f.actions.submitBooking(request(bad)));
    assert.equal(!answer.success && answer.code, 'INVALID_BOOKING', JSON.stringify(bad));
  }
});

test('no usable Square configuration: a booking that owes a deposit is refused, never made without it', async () => {
  const production = { ...SANDBOX_SQUARE_ENV, SQUARE_ENVIRONMENT: 'production', SQUARE_APPLICATION_ID: 'sq0idp-fixture', SQUARE_LOCATION_ID: 'live-location' };
  const environments = [
    // Sandbox credentials in a production build (Vercel production, or VERCEL_ENV missing).
    { NODE_ENV: 'production', VERCEL_ENV: 'production', ...SANDBOX_SQUARE_ENV },
    { NODE_ENV: 'production', ...SANDBOX_SQUARE_ENV },
    // Production credentials anywhere but a production build: a preview, development, a test run.
    { ...production, NODE_ENV: 'production', VERCEL_ENV: 'preview' },
    { ...production, NODE_ENV: 'development' },
    { ...production, NODE_ENV: 'test' },
    // Not configured, switched off, or not parseable.
    {},
    { ...SANDBOX_SQUARE_ENV, SQUARE_PAYMENTS_ENABLED: 'false' },
    { ...SANDBOX_SQUARE_ENV, SQUARE_ACCESS_TOKEN: '[SENSITIVE]' },
  ];
  for (const squareEnv of environments) {
    const f = deposited({ squareEnv });
    const answer = await quietly(() => f.actions.submitBooking(request()));
    assert.deepEqual(answer, { success: false, code: 'PAYMENT_UNAVAILABLE', error: errorText('PAYMENT_UNAVAILABLE') }, JSON.stringify(squareEnv));
    assert.deepEqual(f.rows, []);
    assert.deepEqual(f.attempts, []);
    assert.deepEqual(f.squareCalls.authorize, []);
  }
});

test('production credentials take the deposit in a production build; sandbox works on a preview', async () => {
  const production = {
    ...SANDBOX_SQUARE_ENV, NODE_ENV: 'production', VERCEL_ENV: 'production', SQUARE_ENVIRONMENT: 'production',
    SQUARE_APPLICATION_ID: 'sq0idp-fixture', SQUARE_LOCATION_ID: 'live-location',
  };
  const live = deposited({ squareEnv: production, square: { authorize: async (input) => ({ ...approvedPayment(input), location_id: 'live-location' }) } });
  assert.deepEqual(await live.actions.submitBooking(request()), { success: true, depositHeldPence: 2000 });
  assert.equal(live.attempts[0].environment, 'production');
  assert.equal(live.attempts[0].locationId, 'live-location');

  const preview = deposited({ squareEnv: { ...SANDBOX_SQUARE_ENV, NODE_ENV: 'production', VERCEL_ENV: 'preview' } });
  assert.deepEqual(await preview.actions.submitBooking(request()), { success: true, depositHeldPence: 2000 });
  assert.equal(preview.attempts[0].environment, 'sandbox');
});

test('every new customer error reads in both languages', () => {
  for (const code of ['PAYMENT_REQUIRED', 'PAYMENT_UNAVAILABLE', 'CARD_DECLINED', 'PAYMENT_UNCERTAIN', 'QUOTE_CHANGED', 'PAYMENT_PENDING']) {
    for (const locale of ['en-GB', 'zh-HK'] as const) {
      const text = translator(locale, 'errors').dynamic(`booking.${code}`);
      assert.ok(text && !text.startsWith('booking.'), `${locale} ${code}`);
    }
  }
  assert.match(errorText('PAYMENT_UNAVAILABLE'), /call the salon/);
  assert.match(errorText('PAYMENT_UNCERTAIN'), /nothing was booked.*released automatically/);
});
