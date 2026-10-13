import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import {
  CAPTURE_STALE_MS, createPaymentAttemptService, depositIdempotencyKey, depositPaymentNote, depositRequestJson, isCaptureStale, replayAnswer, type DepositAttempt,
} from './payment-attempts';
import { SquareGatewayError, type SquarePayment } from './square-gateway';
import { OPERATIONS_MESSAGES } from './operations-messages';
import { loadServerModule } from '../../test/load-server-module';

const NOW = new Date('2026-10-01T09:00:00Z');
const KEY = '3b241101-e2bb-4255-8caf-4136c566a962';
const REQUEST = { serviceId: 'service-1', stylist: 'any', start: '2026-10-06T10:00:00.000Z' };
const POLICY = { enabled: true, percent: 20, minimumServicePence: 0, overridePence: null };
const CONFIG = { environment: 'sandbox' as const, locationId: 'location-1' };

type Row = Record<string, unknown> & { id: string; status: string };

function approved(overrides: Partial<SquarePayment> = {}): SquarePayment {
  return {
    id: 'payment-1', status: 'APPROVED', amount_money: { amount: 2000, currency: 'GBP' }, location_id: 'location-1',
    source_type: 'CARD', reference_id: 'attempt-1', delay_action: 'CANCEL', delayed_until: '2026-10-08T09:00:00Z', ...overrides,
  };
}

/** One PaymentAttempt table and a scripted gateway; records every Square call. */
function harness(options: {
  authorize?: () => Promise<SquarePayment>;
  cancel?: () => Promise<SquarePayment>;
  cancelByIdempotencyKey?: () => Promise<void>;
  failWrites?: (data: Record<string, unknown>) => boolean;
} = {}, factory: typeof createPaymentAttemptService = createPaymentAttemptService) {
  const rows: Row[] = [];
  const calls = { authorize: [] as unknown[], cancel: [] as unknown[], cancelByIdempotencyKey: [] as string[] };
  const db = {
    paymentAttempt: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (rows.some((row) => row.userId === data.userId && row.attemptKey === data.attemptKey)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        }
        const row = { id: `attempt-${rows.length + 1}`, appointmentId: null, squarePaymentId: null, lastError: null, ...data } as unknown as Row;
        rows.push(row);
        return { ...row };
      },
      findUnique: async ({ where }: { where: { userId_attemptKey: { userId: string; attemptKey: string } } }) => {
        const row = rows.find((candidate) => candidate.userId === where.userId_attemptKey.userId && candidate.attemptKey === where.userId_attemptKey.attemptKey);
        return row ? { ...row } : null;
      },
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        if (options.failWrites?.(data)) throw new Error("Can't reach database server");
        const matched = rows.filter((row) => row.id === where.id && row.status === where.status);
        for (const row of matched) Object.assign(row, data);
        return { count: matched.length };
      },
    },
  };
  const gateway = {
    authorize: async (input: unknown) => { calls.authorize.push(input); return (options.authorize ?? (async () => approved()))(); },
    cancel: async (input: unknown) => { calls.cancel.push(input); return (options.cancel ?? (async () => approved({ status: 'CANCELED' })))(); },
    cancelByIdempotencyKey: async (key: string) => { calls.cancelByIdempotencyKey.push(key); await options.cancelByIdempotencyKey?.(); },
  };
  const service = factory({ db: db as never, gateway: gateway as never, now: () => NOW });
  const create = () => service.create({ userId: 'user-1', attemptKey: KEY, amountPence: 2000, quoteAmountPence: 10000, policy: POLICY, request: REQUEST, config: CONFIG });
  return { rows, calls, service, create };
}

async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const errors = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = errors;
  }
}

test('the Square idempotency key is the attempt key, compact and within Square’s 45 characters', () => {
  const key = depositIdempotencyKey(KEY);
  assert.equal(key, 'dep_3b241101e2bb42558caf4136c566a962');
  assert.ok(key.length <= 45);
  assert.match(key, /^[A-Za-z0-9_-]+$/);
  assert.equal(depositIdempotencyKey(KEY.toUpperCase()), key, 'one submission, one key, whatever its spelling');
});

test('the payment note says what the deposit is for and nothing about who paid', () => {
  assert.equal(depositPaymentNote('Cut & Blow Dry', '2026-10-06', '11:00'), 'Booking deposit: Cut & Blow Dry on 2026-10-06 at 11:00 (salon time)');
  assert.equal(depositPaymentNote('  ', '2026-10-06', '11:00'), 'Booking deposit: service on 2026-10-06 at 11:00 (salon time)');
  assert.equal(depositPaymentNote('x'.repeat(600), '2026-10-06', '11:00').length, 500);
});

test('an attempt is written INITIATED, with its quote, policy and request, before Square is asked anything', async () => {
  const h = harness();
  const attempt = await h.create();
  assert.ok(attempt);
  assert.equal(h.calls.authorize.length, 0);
  assert.deepEqual({ ...h.rows[0] }, {
    id: 'attempt-1', appointmentId: null, squarePaymentId: null, lastError: null,
    userId: 'user-1', attemptKey: KEY, idempotencyKey: 'dep_3b241101e2bb42558caf4136c566a962', status: 'INITIATED',
    environment: 'sandbox', locationId: 'location-1', amountPence: 2000, currency: 'GBP', quoteAmountPence: 10000,
    policyJson: JSON.stringify(POLICY), requestJson: depositRequestJson(REQUEST),
  });
  assert.equal(await h.create(), null, 'the same key again is a duplicate to replay, not a second attempt');
  assert.equal(h.rows.length, 1);
  assert.deepEqual(await h.service.find('user-1', KEY), { ...h.rows[0] });
  assert.equal(await h.service.find('user-2', KEY), null, 'keys are per customer');
});

test('other database failures are not mistaken for a duplicate', async () => {
  const db = { paymentAttempt: { create: async () => { throw new Error("Can't reach database server"); } } };
  const service = createPaymentAttemptService({ db: db as never, gateway: {} as never });
  await assert.rejects(service.create({ userId: 'user-1', attemptKey: KEY, amountPence: 1, quoteAmountPence: 1, policy: POLICY, request: REQUEST, config: CONFIG }), /reach database/);
});

test('an approved authorization is recorded with its payment id and hold expiry', async () => {
  const h = harness();
  const attempt = (await h.create())!;
  const result = await h.service.authorize(attempt, { sourceId: 'cnon:ok', note: 'Booking deposit: Cut' });
  assert.deepEqual(h.calls.authorize, [{ sourceId: 'cnon:ok', amountPence: 2000, idempotencyKey: attempt.idempotencyKey, referenceId: attempt.id, note: 'Booking deposit: Cut' }]);
  assert.equal(result.outcome, 'AUTHORIZED');
  assert.equal(result.outcome === 'AUTHORIZED' && result.attempt.squarePaymentId, 'payment-1');
  assert.equal(h.rows[0].status, 'AUTHORIZED');
  assert.equal(h.rows[0].squarePaymentId, 'payment-1');
  assert.deepEqual(h.rows[0].delayedUntil, new Date('2026-10-08T09:00:00Z'));
  assert.deepEqual(h.rows[0].authorizedAt, NOW);
});

for (const httpStatus of [400, 402]) {
  test(`a refusal of the card (HTTP ${httpStatus}) is DECLINED: FAILED with our own words, and nothing is cancelled`, async () => {
    const h = harness({ authorize: async () => { throw new SquareGatewayError('provider_error', httpStatus); } });
    const result = await h.service.authorize((await h.create())!, { sourceId: 'cnon:declined', note: 'n' });
    assert.deepEqual(result, { outcome: 'DECLINED' });
    assert.equal(h.rows[0].status, 'FAILED');
    assert.equal(h.rows[0].lastError, OPERATIONS_MESSAGES.PAYMENT_DECLINED);
    assert.deepEqual(h.calls.cancelByIdempotencyKey, []);
  });
}

// Review W-A: Square answers 401/403/404 when the WEBSITE's access token,
// permissions or location are wrong. That is never the customer's card: it
// must not read as a decline (CARD_DECLINED, the decline budget, the card-testing
// count) but as a configuration problem nothing was sent through.
test('Square refusing the request itself (401, 403, 404, any other 4xx) is a setup problem, never a decline — logged once per status', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  // A fresh copy of the module: each HTTP status is reported once per server instance.
  const fresh = loadServerModule<typeof import('./payment-attempts')>('src/app/services/payment-attempts.ts', {});
  for (const httpStatus of [401, 403, 404, 409, 422, undefined, 401, 403]) {
    const h = harness({ authorize: async () => { throw new SquareGatewayError('provider_error', httpStatus); } }, fresh.createPaymentAttemptService);
    const result = await h.service.authorize((await h.create())!, { sourceId: 'cnon:ok', note: 'n' });
    assert.deepEqual(result, { outcome: 'SETUP_REFUSED' }, String(httpStatus));
    assert.equal(h.rows[0].status, 'FAILED', 'nothing is held');
    assert.equal(h.rows[0].lastError, OPERATIONS_MESSAGES.PAYMENT_SETUP_REFUSED);
    assert.deepEqual(h.calls.cancelByIdempotencyKey, [], 'Square created nothing to cancel');
  }
  // 401, 403, 404, 409, 422 and "no status" once each; the repeats are not logged again.
  assert.equal(logged.mock.callCount(), 6);
  assert.deepEqual(logged.mock.calls.map((call) => (call.arguments[1] as { httpStatus: unknown }).httpStatus), [401, 403, 404, 409, 422, null]);
  for (const call of logged.mock.calls) assert.match(String(call.arguments[0]), /Square refused a deposit authorization/);
});

test('a card token that never left this server (invalid input) is not a decline: FAILED as never sent', async (t) => {
  t.mock.method(console, 'error', () => {});
  const h = harness({ authorize: async () => { throw new SquareGatewayError('invalid_input'); } });
  assert.deepEqual(await h.service.authorize((await h.create())!, { sourceId: 'CASH', note: 'n' }), { outcome: 'UNAVAILABLE' });
  assert.deepEqual([h.rows[0].status, h.rows[0].lastError], ['FAILED', OPERATIONS_MESSAGES.PAYMENT_NOT_SENT]);
  assert.deepEqual(h.calls.cancelByIdempotencyKey, []);
});

test('payments switched off before the call: FAILED as never sent', async () => {
  const h = harness({ authorize: async () => { throw new SquareGatewayError('disabled'); } });
  assert.deepEqual(await h.service.authorize((await h.create())!, { sourceId: 'cnon:ok', note: 'n' }), { outcome: 'UNAVAILABLE' });
  assert.equal(h.rows[0].lastError, OPERATIONS_MESSAGES.PAYMENT_NOT_SENT);
});

for (const failure of [new SquareGatewayError('unknown_outcome'), new SquareGatewayError('invalid_response'), new TypeError('fetch failed')]) {
  test(`no usable answer (${failure.message}): UNKNOWN, then cancelled by the same key`, async () => {
    const h = harness({ authorize: async () => { throw failure; } });
    const attempt = (await h.create())!;
    assert.deepEqual(await quietly(() => h.service.authorize(attempt, { sourceId: 'cnon:ok', note: 'n' })), { outcome: 'UNCERTAIN' });
    assert.deepEqual(h.calls.cancelByIdempotencyKey, [attempt.idempotencyKey]);
    assert.equal(h.rows[0].status, 'VOIDED');
    assert.deepEqual(h.rows[0].voidedAt, NOW);
    assert.equal(h.rows[0].lastError, OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED);
  });
}

test('if the cancel by key fails too, the attempt stays UNKNOWN for reconciliation', async () => {
  const h = harness({
    authorize: async () => { throw new SquareGatewayError('unknown_outcome'); },
    cancelByIdempotencyKey: async () => { throw new SquareGatewayError('unknown_outcome'); },
  });
  assert.deepEqual(await h.service.authorize((await h.create())!, { sourceId: 'cnon:ok', note: 'n' }), { outcome: 'UNCERTAIN' });
  assert.equal(h.rows[0].status, 'UNKNOWN');
  assert.equal(h.rows[0].lastError, OPERATIONS_MESSAGES.PAYMENT_OUTCOME_UNKNOWN);
});

test('a hold Square granted but this server could not record is released by key, never booked', async () => {
  const h = harness({ failWrites: (data) => data.status === 'AUTHORIZED' });
  const attempt = (await h.create())!;
  const result = await quietly(() => h.service.authorize(attempt, { sourceId: 'cnon:ok', note: 'n' }));
  assert.deepEqual(result, { outcome: 'UNCERTAIN' });
  assert.deepEqual(h.calls.cancelByIdempotencyKey, [attempt.idempotencyKey]);
  assert.equal(h.rows[0].status, 'INITIATED', 'left for reconciliation');
});

test('recording never overwrites a state someone else moved the attempt to', async () => {
  const h = harness({ authorize: async () => { throw new SquareGatewayError('provider_error', 402); } });
  const attempt = (await h.create())!;
  // e.g. S4's webhook or reconciliation got there first.
  h.rows[0].status = 'VOIDED';
  await h.service.authorize(attempt, { sourceId: 'cnon:ok', note: 'n' });
  assert.equal(h.rows[0].status, 'VOIDED');
  assert.equal(h.rows[0].lastError, null);
});

test('releasing a hold cancels exactly that payment and records it VOIDED', async () => {
  const h = harness();
  const attempt = (await h.create())!;
  const authorized = await h.service.authorize(attempt, { sourceId: 'cnon:ok', note: 'n' });
  assert.equal(authorized.outcome, 'AUTHORIZED');
  const hold = authorized.outcome === 'AUTHORIZED' ? authorized.attempt : attempt;
  assert.equal(await h.service.release(hold, OPERATIONS_MESSAGES.PAYMENT_RELEASED_NOT_BOOKED), true);
  assert.deepEqual(h.calls.cancel, [{ paymentId: 'payment-1', amountPence: 2000, referenceId: attempt.id }]);
  assert.equal(h.rows[0].status, 'VOIDED');
  assert.deepEqual(h.rows[0].voidedAt, NOW);
  assert.equal(h.rows[0].lastError, OPERATIONS_MESSAGES.PAYMENT_RELEASED_NOT_BOOKED);
});

test('a failed release never throws: the hold stays AUTHORIZED and marked for reconciliation', async () => {
  const h = harness({ cancel: async () => { throw new SquareGatewayError('unknown_outcome', 503); } });
  const attempt = (await h.create())!;
  const authorized = await h.service.authorize(attempt, { sourceId: 'cnon:ok', note: 'n' });
  const hold = authorized.outcome === 'AUTHORIZED' ? authorized.attempt : attempt;
  assert.equal(await quietly(() => h.service.release(hold)), false);
  assert.equal(h.rows[0].status, 'AUTHORIZED');
  assert.equal(h.rows[0].lastError, OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED);
  // Nothing to cancel without a Square payment id.
  assert.equal(await h.service.release({ id: 'attempt-x', amountPence: 1, squarePaymentId: null }), false);
  assert.equal(h.calls.cancel.length, 1);
});

test('a replay is answered from what the first submission left behind', () => {
  const attempt = (status: string, lastError: string | null = null, appointmentId: string | null = null) => ({ status, lastError, appointmentId }) as Pick<DepositAttempt, 'status' | 'lastError' | 'appointmentId'>;
  assert.equal(replayAnswer(attempt('AUTHORIZED', null, 'appointment-1')), 'BOOKED');
  assert.equal(replayAnswer(attempt('FAILED', OPERATIONS_MESSAGES.PAYMENT_DECLINED)), 'CARD_DECLINED');
  assert.equal(replayAnswer(attempt('FAILED', OPERATIONS_MESSAGES.PAYMENT_NOT_SENT)), 'PAYMENT_UNAVAILABLE');
  // Refused by the website's own Square setup (review W-A): never "your card was declined".
  assert.equal(replayAnswer(attempt('FAILED', OPERATIONS_MESSAGES.PAYMENT_SETUP_REFUSED)), 'PAYMENT_UNAVAILABLE');
  assert.equal(replayAnswer(attempt('VOIDED', OPERATIONS_MESSAGES.PAYMENT_RELEASED_NOT_BOOKED)), 'SLOT_UNAVAILABLE');
  assert.equal(replayAnswer(attempt('VOIDED', OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED)), 'PAYMENT_UNCERTAIN');
  assert.equal(replayAnswer(attempt('AUTHORIZED', OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED)), 'PAYMENT_UNCERTAIN');
  // Still with Square, or between Square and the booking: wait.
  for (const status of ['INITIATED', 'AUTHORIZED']) assert.equal(replayAnswer(attempt(status)), 'PAYMENT_PENDING', status);
});

test('a replay of an authorization Square never answered says what the first answer said: uncertain, not pending', () => {
  const attempt = (status: string, lastError: string | null) => ({ status, lastError, appointmentId: null }) as Pick<DepositAttempt, 'status' | 'lastError' | 'appointmentId'>;
  // Not yet cancelled by key (reconciliation will), and cancelled by key.
  assert.equal(replayAnswer(attempt('UNKNOWN', OPERATIONS_MESSAGES.PAYMENT_OUTCOME_UNKNOWN)), 'PAYMENT_UNCERTAIN');
  assert.equal(replayAnswer(attempt('UNKNOWN', null)), 'PAYMENT_UNCERTAIN');
  assert.equal(replayAnswer(attempt('VOIDED', OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED)), 'PAYMENT_UNCERTAIN');
});

// --- Taking the deposit when staff confirm (S3) ---------------------------------

type CaptureScript = {
  getPayment?: (call: number) => Promise<SquarePayment>;
  capture?: () => Promise<SquarePayment>;
};

/** One attempt the approval has claimed (CAPTURING), and a scripted Square. */
function captureHarness(script: CaptureScript = {}, status = 'CAPTURING', updatedAt = NOW) {
  const row: Row = { id: 'attempt-1', status, amountPence: 2000, squarePaymentId: 'payment-1', lastError: null, updatedAt, capturedAt: null, delayedUntil: new Date('2026-10-08T09:00:00Z') };
  const calls: string[] = [];
  const captures: unknown[] = [];
  let reads = 0;
  const db = {
    paymentAttempt: {
      updateMany: async ({ where, data }: { where: { id: string; status: string; updatedAt?: Date }; data: Record<string, unknown> }) => {
        const matches = row.id === where.id && row.status === where.status && (!where.updatedAt || (row.updatedAt as Date).getTime() === where.updatedAt.getTime());
        if (matches) Object.assign(row, data);
        return { count: matches ? 1 : 0 };
      },
    },
  };
  const gateway = {
    getPayment: async () => { calls.push('getPayment'); return (script.getPayment ?? (async () => approved({ version_token: 'v1' })))(++reads); },
    capture: async (input: unknown) => { calls.push('capture'); captures.push(input); return (script.capture ?? (async () => approved({ status: 'COMPLETED' })))(); },
  };
  const service = createPaymentAttemptService({ db: db as never, gateway: gateway as never, now: () => NOW });
  const attempt = { id: 'attempt-1', amountPence: 2000, squarePaymentId: 'payment-1' };
  return { row, calls, captures, service, attempt };
}

test('a capture reads the payment first, then takes it with the version Square gave', async () => {
  const h = captureHarness();
  assert.equal(await h.service.capture(h.attempt, 'AUTHORIZED'), 'CAPTURED');
  assert.deepEqual(h.calls, ['getPayment', 'capture']);
  assert.deepEqual(h.captures, [{ paymentId: 'payment-1', amountPence: 2000, referenceId: 'attempt-1', versionToken: 'v1' }]);
  assert.equal(h.row.status, 'CAPTURING', 'the caller records it with the booking');
});

test('a payment Square already shows taken is not captured again', async () => {
  const h = captureHarness({ getPayment: async () => approved({ status: 'COMPLETED' }) });
  assert.equal(await h.service.capture(h.attempt, 'CAPTURE_UNKNOWN'), 'CAPTURED');
  assert.deepEqual(h.calls, ['getPayment']);
});

test('a hold Square has dropped is EXPIRED; a payment that is not this deposit is never taken', async () => {
  for (const status of ['CANCELED', 'FAILED'] as const) {
    const h = captureHarness({ getPayment: async () => approved({ status }) });
    assert.equal(await h.service.capture(h.attempt, 'AUTHORIZED'), 'EXPIRED', status);
    assert.deepEqual([h.row.status, h.row.lastError, h.calls], ['EXPIRED', OPERATIONS_MESSAGES.PAYMENT_HOLD_CANCELLED, ['getPayment']]);
  }
  for (const mismatch of [{ amount_money: { amount: 1999, currency: 'GBP' as const } }, { reference_id: 'someone-else' }, { id: 'payment-2' }]) {
    const h = captureHarness({ getPayment: async () => approved({ version_token: 'v1', ...mismatch }) });
    assert.equal(await h.service.capture(h.attempt, 'AUTHORIZED'), 'REFUSED', JSON.stringify(mismatch));
    assert.deepEqual([h.row.status, h.row.lastError, h.calls], ['AUTHORIZED', OPERATIONS_MESSAGES.PAYMENT_MISMATCH, ['getPayment']]);
  }
});

test('when the read fails nothing was asked that could move money: the attempt is back where it was', async () => {
  const unreachable = captureHarness({ getPayment: async () => { throw new SquareGatewayError('unknown_outcome'); } });
  assert.equal(await unreachable.service.capture(unreachable.attempt, 'AUTHORIZED'), 'UNCONFIRMED');
  assert.deepEqual([unreachable.row.status, unreachable.row.lastError], ['AUTHORIZED', OPERATIONS_MESSAGES.PAYMENT_CHECK_FAILED]);
  const stillUnknown = captureHarness({ getPayment: async () => { throw new SquareGatewayError('unknown_outcome'); } });
  assert.equal(await stillUnknown.service.capture(stillUnknown.attempt, 'CAPTURE_UNKNOWN'), 'UNCONFIRMED');
  assert.deepEqual([stillUnknown.row.status, stillUnknown.row.lastError], ['CAPTURE_UNKNOWN', OPERATIONS_MESSAGES.PAYMENT_CAPTURE_UNKNOWN]);
  const off = captureHarness({ getPayment: async () => { throw new SquareGatewayError('disabled'); } });
  assert.equal(await off.service.capture(off.attempt, 'AUTHORIZED'), 'UNAVAILABLE');
  assert.equal(off.row.status, 'AUTHORIZED');
  const noPayment = captureHarness();
  assert.equal(await noPayment.service.capture({ ...noPayment.attempt, squarePaymentId: null }, 'AUTHORIZED'), 'REFUSED');
  assert.deepEqual(noPayment.calls, []);
});

test('Square refusing the capture: the hold stands (AUTHORIZED), or EXPIRED when Square has cancelled it', async () => {
  const refused = captureHarness({
    getPayment: async (call) => approved(call === 1 ? { version_token: 'v1' } : {}),
    capture: async () => { throw new SquareGatewayError('provider_error', 400); },
  });
  assert.equal(await refused.service.capture(refused.attempt, 'AUTHORIZED'), 'REFUSED');
  assert.deepEqual(refused.calls, ['getPayment', 'capture', 'getPayment']);
  assert.deepEqual([refused.row.status, refused.row.lastError], ['AUTHORIZED', OPERATIONS_MESSAGES.PAYMENT_CAPTURE_REFUSED]);

  const cancelled = captureHarness({
    getPayment: async (call) => approved(call === 1 ? { version_token: 'v1' } : { status: 'CANCELED' }),
    capture: async () => { throw new SquareGatewayError('provider_error', 400); },
  });
  assert.equal(await cancelled.service.capture(cancelled.attempt, 'AUTHORIZED'), 'EXPIRED');
  assert.equal(cancelled.row.status, 'EXPIRED');

  // Refused, and Square cannot be read afterwards: an earlier unanswered capture stays unanswered.
  const unread = captureHarness({
    getPayment: async (call) => { if (call === 1) return approved({ version_token: 'v1' }); throw new SquareGatewayError('unknown_outcome'); },
    capture: async () => { throw new SquareGatewayError('provider_error', 409); },
  });
  assert.equal(await unread.service.capture(unread.attempt, 'CAPTURE_UNKNOWN'), 'REFUSED');
  assert.equal(unread.row.status, 'CAPTURE_UNKNOWN');
});

test('a capture with no answer: COMPLETED afterwards is taken; anything else is CAPTURE_UNKNOWN, never retried blindly', async () => {
  const completed = captureHarness({
    getPayment: async (call) => approved(call === 1 ? { version_token: 'v1' } : { status: 'COMPLETED' }),
    capture: async () => { throw new SquareGatewayError('unknown_outcome'); },
  });
  assert.equal(await completed.service.capture(completed.attempt, 'AUTHORIZED'), 'CAPTURED');
  assert.deepEqual(completed.calls, ['getPayment', 'capture', 'getPayment']);

  for (const after of [async () => approved({}), async () => { throw new SquareGatewayError('unknown_outcome'); }] as (() => Promise<SquarePayment>)[]) {
    const unknown = captureHarness({
      getPayment: async (call) => (call === 1 ? approved({ version_token: 'v1' }) : after()),
      capture: async () => { throw new SquareGatewayError('invalid_response'); },
    });
    assert.equal(await unknown.service.capture(unknown.attempt, 'AUTHORIZED'), 'UNCONFIRMED');
    assert.deepEqual([unknown.row.status, unknown.row.lastError], ['CAPTURE_UNKNOWN', OPERATIONS_MESSAGES.PAYMENT_CAPTURE_UNKNOWN]);
    assert.equal(unknown.calls.filter((call) => call === 'capture').length, 1);
  }
});

test('settling an unanswered capture claims it, reads Square once and records what it says', async () => {
  const quietSince = new Date(NOW.getTime() - 3 * 60_000);
  const cases: [SquarePayment['status'], string, string][] = [
    ['COMPLETED', 'CAPTURED', 'CAPTURED'],
    ['APPROVED', 'AUTHORIZED', 'AUTHORIZED'],
    ['CANCELED', 'EXPIRED', 'EXPIRED'],
  ];
  for (const [square, outcome, status] of cases) {
    const h = captureHarness({ getPayment: async () => approved({ status: square }) }, 'CAPTURE_UNKNOWN', quietSince);
    assert.equal(await h.service.settle({ ...h.attempt, status: 'CAPTURE_UNKNOWN', updatedAt: quietSince }), outcome, square);
    assert.equal(h.row.status, status);
    assert.deepEqual(h.calls, ['getPayment'], 'never a capture');
  }
  const taken = captureHarness({ getPayment: async () => approved({ status: 'COMPLETED' }) }, 'CAPTURE_UNKNOWN', quietSince);
  await taken.service.settle({ ...taken.attempt, status: 'CAPTURE_UNKNOWN', updatedAt: quietSince });
  assert.deepEqual([taken.row.capturedAt, taken.row.lastError], [NOW, OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED]);

  const silent = captureHarness({ getPayment: async () => { throw new SquareGatewayError('unknown_outcome'); } }, 'CAPTURE_UNKNOWN', quietSince);
  assert.equal(await silent.service.settle({ ...silent.attempt, status: 'CAPTURE_UNKNOWN', updatedAt: quietSince }), 'UNCONFIRMED');
  assert.equal(silent.row.status, 'CAPTURE_UNKNOWN');
});

// Money-safety review I1: a CompletePayment that timed out may still be on its
// way. Read Square straight away and it shows APPROVED; release the hold on that
// word and the capture can land afterwards, taking money from a closed booking.
test('an unanswered capture is settled only once it has been quiet for 2 minutes: the timed-out capture may still land', async () => {
  const fresh = captureHarness({ getPayment: async () => approved({ status: 'APPROVED' }) }, 'CAPTURE_UNKNOWN', new Date(NOW.getTime() - 60_000));
  assert.equal(await fresh.service.settle({ ...fresh.attempt, status: 'CAPTURE_UNKNOWN', updatedAt: fresh.row.updatedAt as Date }), 'BUSY');
  assert.deepEqual([fresh.calls, fresh.row.status], [[], 'CAPTURE_UNKNOWN'], 'Square is not even asked');
  assert.equal(isCaptureStale({ status: 'CAPTURE_UNKNOWN', updatedAt: new Date(NOW.getTime() - CAPTURE_STALE_MS + 1) }, NOW), false);
  assert.equal(isCaptureStale({ status: 'CAPTURE_UNKNOWN', updatedAt: new Date(NOW.getTime() - CAPTURE_STALE_MS) }, NOW), true);
  assert.equal(isCaptureStale({ status: 'CAPTURING', updatedAt: new Date(NOW.getTime() - CAPTURE_STALE_MS) }, NOW), true);
  for (const status of ['AUTHORIZED', 'CAPTURED', 'KEPT']) assert.equal(isCaptureStale({ status, updatedAt: new Date(0) }, NOW), false, status);
});

test('a capture under way is never settled; a stale claim is, and only by one of two at once', async () => {
  const fresh = captureHarness({}, 'CAPTURING', new Date(NOW.getTime() - 60_000));
  assert.equal(await fresh.service.settle({ ...fresh.attempt, status: 'CAPTURING', updatedAt: fresh.row.updatedAt as Date }), 'BUSY');
  assert.deepEqual(fresh.calls, []);

  const staleAt = new Date(NOW.getTime() - 3 * 60_000);
  const stale = captureHarness({ getPayment: async () => approved({ status: 'COMPLETED' }) }, 'CAPTURING', staleAt);
  const seen = { ...stale.attempt, status: 'CAPTURING', updatedAt: staleAt };
  const answers = await Promise.all([stale.service.settle(seen), stale.service.settle(seen)]);
  assert.deepEqual(answers.sort(), ['BUSY', 'CAPTURED']);
  assert.deepEqual(stale.calls, ['getPayment']);
});
