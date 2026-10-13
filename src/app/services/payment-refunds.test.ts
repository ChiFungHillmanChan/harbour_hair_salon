import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRefundRequest, followRefund, isRefundProgress, isRefundRetryWindowOver, REFUND_REASONS, REFUND_RETRY_WINDOW_MS, REFUND_SUBMIT_STALE_MS,
  refundableRemainderPence, refundIdempotencyKey, settleRefundOutsideWebsite, submitRefund,
} from './payment-refunds';
import { SquareGatewayError, type SquareRefund } from './square-gateway';
import { translator } from '../../i18n/messages';
import { attempt as attemptRow, paymentsDb, refund as refundRow } from '../../test/payments-fixture';
import { depositView } from '../lib/deposit-display';

const NOW = new Date('2099-09-01T12:00:00Z');
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);

type Attempt = { id: string; status: string; amountPence: number; squarePaymentId: string | null; environment: string; locationId: string };
type Refund = {
  id: string; attemptId: string; idempotencyKey: string; squareRefundId: string | null; amountPence: number; status: string; reason: string;
  requestedById: string | null; updatedAt: Date;
};
type RefundCall = { paymentId: string; amountPence: number; idempotencyKey: string; reason?: string };

/** One taken deposit, its refund rows, and a scripted Square refund endpoint. The clock is NOW until `setNow`. */
function harness(options: {
  attempt?: Partial<Attempt>; refunds?: Partial<Refund>[]; noGateway?: boolean;
  /** Square's answer; `rows` is the refund table as it stands while Square is being asked. */
  refund?: (input: { idempotencyKey: string; amountPence: number }, rows: Refund[]) => Promise<SquareRefund>;
} = {}) {
  let now = NOW;
  const attempt: Attempt = { id: 'attempt-1', status: 'CAPTURED', amountPence: 2000, squarePaymentId: 'payment-1', environment: 'sandbox', locationId: 'location-1', ...options.attempt };
  const refunds: Refund[] = (options.refunds ?? []).map((refund, index) => ({
    id: `existing-${index}`, attemptId: 'attempt-1', idempotencyKey: `rfd_existing${index}`, squareRefundId: null, amountPence: 2000,
    status: 'COMPLETED', reason: 'STAFF_CANCELLED', requestedById: null, updatedAt: minutes(-60), ...refund,
  }));
  const calls: RefundCall[] = [];
  const db = {
    paymentAttempt: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === attempt.id ? { ...attempt } : null) },
    paymentRefund: {
      findMany: async ({ where }: { where: { attemptId: string; status: { in: string[] } } }) =>
        refunds.filter((row) => row.attemptId === where.attemptId && where.status.in.includes(row.status)).map((row) => ({ amountPence: row.amountPence })),
      create: async ({ data }: { data: Omit<Refund, 'id' | 'squareRefundId' | 'updatedAt'> }) => {
        const row = { id: `refund-${refunds.length + 1}`, squareRefundId: null, updatedAt: now, ...data };
        refunds.push(row);
        return { id: row.id, amountPence: row.amountPence, idempotencyKey: row.idempotencyKey };
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = refunds.find((candidate) => candidate.id === where.id);
        return row ? { ...row, attempt: { ...attempt } } : null;
      },
      // Conditional, like Prisma's; and @updatedAt moves on every write.
      updateMany: async ({ where, data }: { where: { id: string; status: string; updatedAt?: Date }; data: Partial<Refund> }) => {
        const matched = refunds.filter((row) => row.id === where.id && row.status === where.status
          && (where.updatedAt === undefined || row.updatedAt.getTime() === where.updatedAt.getTime()));
        for (const row of matched) Object.assign(row, { updatedAt: now }, data);
        return { count: matched.length };
      },
    },
  };
  const gateway = {
    refund: async (input: RefundCall) => {
      calls.push(input);
      if (options.refund) return options.refund(input, refunds);
      return { id: `square-${input.idempotencyKey}`, payment_id: input.paymentId, location_id: 'location-1', status: 'PENDING' as const, amount_money: { amount: input.amountPence, currency: 'GBP' as const } };
    },
  };
  const deps = { db: db as never, gatewayFor: () => (options.noGateway ? null : gateway), now: () => now };
  return { attempt, refunds, calls, db, deps, setNow: (date: Date) => { now = date; } };
}

const squareRefund = (status: SquareRefund['status']) => async (input: { idempotencyKey: string; amountPence: number }): Promise<SquareRefund> => ({
  id: `square-${input.idempotencyKey}`, payment_id: 'payment-1', location_id: 'location-1', status, amount_money: { amount: input.amountPence, currency: 'GBP' },
});

test('a refund key is new for every refund, stable on its row, and fits Square', () => {
  const keys = new Set(Array.from({ length: 50 }, refundIdempotencyKey));
  assert.equal(keys.size, 50);
  for (const key of keys) {
    assert.match(key, /^rfd_[0-9a-f]{32}$/);
    assert.ok(key.length <= 45);
  }
});

test('a refund request is written REQUESTED with its own key; nothing is asked of Square yet', async () => {
  const h = harness();
  const created = await createRefundRequest(h.db as never, h.attempt, 2000, 'CUSTOMER_CANCELLED', null);
  assert.equal(h.refunds.length, 1);
  assert.deepEqual({ ...h.refunds[0], idempotencyKey: 'key' }, {
    id: created.id, attemptId: 'attempt-1', idempotencyKey: 'key', squareRefundId: null, amountPence: 2000,
    status: 'REQUESTED', reason: 'CUSTOMER_CANCELLED', requestedById: null, updatedAt: NOW,
  });
  assert.equal(created.idempotencyKey, h.refunds[0].idempotencyKey);
  assert.deepEqual(h.calls, []);
});

test('never more than was taken, less what is already refunded or on its way', async () => {
  const h = harness({ refunds: [{ status: 'PENDING', amountPence: 1500 }] });
  assert.equal(await refundableRemainderPence(h.db as never, 'attempt-1'), 500);
  await assert.rejects(createRefundRequest(h.db as never, h.attempt, 501, 'STAFF_CANCELLED', 'admin-1'), /cannot exceed/);
  await createRefundRequest(h.db as never, h.attempt, 500, 'STAFF_CANCELLED', 'admin-1');
  assert.equal(await refundableRemainderPence(h.db as never, 'attempt-1'), 0);
  await assert.rejects(createRefundRequest(h.db as never, h.attempt, 1, 'STAFF_CANCELLED', 'admin-1'), /cannot exceed/);
  for (const amount of [0, -1, 1.5]) await assert.rejects(createRefundRequest(h.db as never, h.attempt, amount, 'STAFF_CANCELLED', null), /positive whole number/);

  // Every state that has returned money or still may counts — including one
  // being sent right now, one the daily run stopped retrying (UNRESOLVED: the
  // first send may have refunded) and one staff settled by hand; failed and
  // rejected ones do not.
  for (const status of ['REQUESTED', 'SUBMITTING', 'PENDING', 'COMPLETED', 'UNKNOWN', 'UNRESOLVED', 'SETTLED_EXTERNALLY']) {
    assert.equal(await refundableRemainderPence(harness({ refunds: [{ status }] }).db as never, 'attempt-1'), 0, status);
  }
  for (const status of ['FAILED', 'REJECTED']) {
    assert.equal(await refundableRemainderPence(harness({ refunds: [{ status }] }).db as never, 'attempt-1'), 2000, status);
  }
  // Kept by staff on cancelling: a deliberate decision, never refunded by the system.
  const kept = harness({ attempt: { status: 'KEPT' } });
  assert.equal(await refundableRemainderPence(kept.db as never, 'attempt-1'), 0, 'KEPT');
  await assert.rejects(createRefundRequest(kept.db as never, kept.attempt, 2000, 'LATE_CAPTURE', null), /cannot exceed/);
  // A hold that was never taken is released, never refunded.
  for (const status of ['AUTHORIZED', 'CAPTURING', 'VOIDED']) {
    const held = harness({ attempt: { status } });
    assert.equal(await refundableRemainderPence(held.db as never, 'attempt-1'), 0, status);
    await assert.rejects(createRefundRequest(held.db as never, held.attempt, 2000, 'STAFF_CANCELLED', null), /cannot exceed/);
  }
});

test('submitting a refund asks Square with the row’s key and records its answer', async () => {
  for (const status of ['PENDING', 'COMPLETED', 'FAILED', 'REJECTED'] as const) {
    const h = harness({ refund: squareRefund(status) });
    const { id, idempotencyKey } = await createRefundRequest(h.db as never, h.attempt, 2000, 'SLOT_LOST', null);
    assert.equal(await submitRefund(id, h.deps), status);
    assert.deepEqual(h.calls, [{ paymentId: 'payment-1', amountPence: 2000, idempotencyKey }]);
    assert.equal(h.refunds[0].status, status);
    assert.equal(h.refunds[0].squareRefundId, `square-${idempotencyKey}`);
    // Square has answered: asking again sends nothing.
    assert.equal(await submitRefund(id, h.deps), status);
    assert.equal(h.calls.length, 1);
  }
});

test('no usable answer is UNKNOWN, and the retry asks again with the same key', async (t) => {
  t.mock.method(console, 'error', () => {});
  let answer: 'throw' | 'ok' = 'throw';
  const h = harness({ refund: async (input) => {
    if (answer === 'throw') throw new SquareGatewayError('unknown_outcome');
    return squareRefund('COMPLETED')(input);
  } });
  const { id, idempotencyKey } = await createRefundRequest(h.db as never, h.attempt, 2000, 'CUSTOMER_CANCELLED', null);
  assert.equal(await submitRefund(id, h.deps), 'UNKNOWN');
  assert.equal(h.refunds[0].status, 'UNKNOWN');
  answer = 'ok';
  assert.equal(await submitRefund(id, h.deps), 'COMPLETED');
  assert.deepEqual(h.calls.map((call) => call.idempotencyKey), [idempotencyKey, idempotencyKey], 'never a new key for the same refund');
  // An unreadable answer is just as unknown.
  const unreadable = harness({ refund: async () => { throw new SquareGatewayError('invalid_response'); } });
  const second = await createRefundRequest(unreadable.db as never, unreadable.attempt, 2000, 'CUSTOMER_CANCELLED', null);
  assert.equal(await submitRefund(second.id, unreadable.deps), 'UNKNOWN');
});

test('Square refusing the FIRST send is FAILED; switched off or unsent goes back to REQUESTED for a later retry', async (t) => {
  t.mock.method(console, 'error', () => {});
  const refused = harness({ refund: async () => { throw new SquareGatewayError('provider_error', 400); } });
  const a = await createRefundRequest(refused.db as never, refused.attempt, 2000, 'STAFF_CANCELLED', 'admin-1');
  assert.equal(await submitRefund(a.id, refused.deps), 'FAILED');
  assert.equal(refused.refunds[0].squareRefundId, null, 'Square never created one');
  assert.equal(refused.calls.length, 1, 'a key never sent before: nothing can exist under it');

  for (const kind of ['disabled', 'invalid_input'] as const) {
    const unsent = harness({ refund: async () => { throw new SquareGatewayError(kind); } });
    const b = await createRefundRequest(unsent.db as never, unsent.attempt, 2000, 'STAFF_CANCELLED', null);
    assert.equal(await submitRefund(b.id, unsent.deps), 'REQUESTED', kind);
    assert.equal(unsent.refunds[0].status, 'REQUESTED');
  }

  const off = harness({ noGateway: true });
  const c = await createRefundRequest(off.db as never, off.attempt, 2000, 'STAFF_CANCELLED', null);
  assert.equal(await submitRefund(c.id, off.deps), 'REQUESTED');
  assert.deepEqual(off.calls, []);
});

test('a refund row without a taken payment is never sent; an unknown row is null', async (t) => {
  t.mock.method(console, 'error', () => {});
  const h = harness({ refunds: [{ status: 'REQUESTED' }] });
  h.attempt.squarePaymentId = null;
  assert.equal(await submitRefund('existing-0', h.deps), 'REQUESTED');
  assert.deepEqual(h.calls, []);
  assert.equal(await submitRefund('missing', h.deps), null);
});

test('every refund reason and state, and a kept deposit, read in Admin → Operations in both languages', () => {
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    const t = translator(locale, 'adminOps');
    const words = [
      ...REFUND_REASONS.map((reason) => t.dynamic(`operations.payments.reasons.${reason}`, undefined, '')),
      ...['REQUESTED', 'SUBMITTING', 'PENDING', 'COMPLETED', 'FAILED', 'REJECTED', 'UNKNOWN', 'UNRESOLVED', 'SETTLED_EXTERNALLY']
        .map((status) => t.dynamic(`operations.payments.refundStatus.${status}`, undefined, '')),
      t.dynamic('operations.payments.attemptStatus.KEPT', undefined, ''),
    ];
    for (const text of words) assert.ok(text.trim().length > 1 && !/^[A-Z_]+$/.test(text), `${locale}: "${text}"`);
  }
});

// Money-safety review W1: a refund retried after Square may already have made
// it must never be recorded FAILED — FAILED gives the remainder back, and the
// next cancellation or staff action would refund the same deposit twice.

test('Square is asked for the payment, the amount and the key only: no free text, so every retry — after any deploy — is the same request', async () => {
  for (const reason of REFUND_REASONS) {
    const h = harness();
    const { id, idempotencyKey } = await createRefundRequest(h.db as never, h.attempt, 2000, reason, null);
    await submitRefund(id, h.deps);
    assert.deepEqual(h.calls, [{ paymentId: 'payment-1', amountPence: 2000, idempotencyKey }], reason);
    assert.equal(h.refunds[0].reason, reason, 'the reason code stays on the row for Operations');
  }
});

test('the first send is claimed (REQUESTED → SUBMITTING) before Square is asked; of two senders only one asks', async () => {
  let during: string | undefined;
  const h = harness({ refund: async (input, rows) => { during = rows[0].status; return squareRefund('PENDING')(input); } });
  const { id } = await createRefundRequest(h.db as never, h.attempt, 2000, 'STAFF_CANCELLED', null);
  assert.equal(await submitRefund(id, h.deps), 'PENDING');
  assert.equal(during, 'SUBMITTING', 'marked before the call, so a crash mid-call is never mistaken for "never sent"');

  const twice = harness();
  const second = await createRefundRequest(twice.db as never, twice.attempt, 2000, 'STAFF_CANCELLED', null);
  const answers = await Promise.all([submitRefund(second.id, twice.deps), submitRefund(second.id, twice.deps)]);
  assert.equal(twice.calls.length, 1);
  assert.deepEqual(answers.sort(), ['PENDING', 'SUBMITTING']);
});

test('the probe: an UNKNOWN refund retried and refused (401 and every other 4xx) stays UNKNOWN, and nothing becomes refundable again', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const httpStatus of [400, 401, 403, 404, 409]) {
    const h = harness({ refunds: [{ status: 'UNKNOWN' }], refund: async () => { throw new SquareGatewayError('provider_error', httpStatus); } });
    assert.equal(await submitRefund('existing-0', h.deps), 'UNKNOWN', String(httpStatus));
    assert.equal(h.refunds[0].status, 'UNKNOWN', `${httpStatus}: the first send may have made it`);
    assert.deepEqual(h.calls.map((call) => call.idempotencyKey), ['rfd_existing0'], 'asked again with its own key');
    assert.equal(await refundableRemainderPence(h.db as never, 'attempt-1'), 0, `${httpStatus}: refundable stays 0`);
    await assert.rejects(createRefundRequest(h.db as never, h.attempt, 1, 'STAFF_CANCELLED', null), /cannot exceed/);
    // Review W-C: the retry touches the row (its last try), so the daily
    // batch, oldest-tried first, moves on to the others next time.
    assert.equal(h.refunds[0].updatedAt.getTime(), NOW.getTime(), `${httpStatus}: touched`);
  }
});

test('an UNKNOWN retry that gets no usable answer, or never passes the gateway checks, is touched too and stays UNKNOWN', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const kind of ['unknown_outcome', 'invalid_response', 'invalid_input'] as const) {
    const h = harness({ refunds: [{ status: 'UNKNOWN' }], refund: async () => { throw new SquareGatewayError(kind); } });
    assert.equal(await submitRefund('existing-0', h.deps), 'UNKNOWN', kind);
    assert.deepEqual([h.refunds[0].status, h.refunds[0].updatedAt.getTime()], ['UNKNOWN', NOW.getTime()], kind);
  }
  // The touch is conditional on the row as read: a writer that got there first (Square's notice) wins.
  const raced = harness({ refunds: [{ status: 'UNKNOWN' }], refund: async (_input, rows) => {
    Object.assign(rows[0], { status: 'PENDING', squareRefundId: 'sq-from-notice', updatedAt: minutes(-1) });
    throw new SquareGatewayError('unknown_outcome');
  } });
  assert.equal(await submitRefund('existing-0', raced.deps), 'PENDING', 'answered with the row as it now is');
  assert.deepEqual([raced.refunds[0].status, raced.refunds[0].updatedAt.getTime()], ['PENDING', minutes(-1).getTime()], 'the notice stands');
});

test('UNRESOLVED (retries stopped) and SETTLED_EXTERNALLY (settled by staff) are never sent again', async () => {
  for (const status of ['UNRESOLVED', 'SETTLED_EXTERNALLY']) {
    const h = harness({ refunds: [{ status }] });
    assert.equal(await submitRefund('existing-0', h.deps), status);
    assert.deepEqual(h.calls, [], status);
  }
});

test('a refund is given up on (UNRESOLVED) only once it was sent and is past the 7-day retry window; never a REQUESTED one', () => {
  const at = (status: string, daysAgo: number) => ({ status, createdAt: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60_000) });
  assert.equal(REFUND_RETRY_WINDOW_MS, 7 * 24 * 60 * 60_000);
  for (const status of ['UNKNOWN', 'SUBMITTING']) {
    assert.equal(isRefundRetryWindowOver(at(status, 7), NOW), true, `${status}, 7 days`);
    assert.equal(isRefundRetryWindowOver(at(status, 6.9), NOW), false, `${status}, under 7 days`);
  }
  // Never sent: provably no refund exists under its key, so sending it is always safe.
  assert.equal(isRefundRetryWindowOver(at('REQUESTED', 30), NOW), false);
  for (const status of ['PENDING', 'COMPLETED', 'FAILED', 'UNRESOLVED']) assert.equal(isRefundRetryWindowOver(at(status, 30), NOW), false, status);
});

test('a send in progress is left to its sender; one SUBMITTING for over 2 minutes is retried as UNKNOWN — and a refusal then is never FAILED', async (t) => {
  t.mock.method(console, 'error', () => {});
  const fresh = harness({ refunds: [{ status: 'SUBMITTING', updatedAt: new Date(NOW.getTime() - REFUND_SUBMIT_STALE_MS + 1_000) }] });
  assert.equal(await submitRefund('existing-0', fresh.deps), 'SUBMITTING');
  assert.deepEqual(fresh.calls, []);

  // The sender died after (or before) asking Square: Square refuses the retry.
  const refused = harness({ refunds: [{ status: 'SUBMITTING', updatedAt: minutes(-3) }], refund: async () => { throw new SquareGatewayError('provider_error', 401); } });
  assert.equal(await submitRefund('existing-0', refused.deps), 'UNKNOWN');
  assert.equal(refused.refunds[0].status, 'UNKNOWN');
  assert.equal(refused.calls.length, 1);
  // No answer to the retry either: still UNKNOWN.
  const silent = harness({ refunds: [{ status: 'SUBMITTING', updatedAt: minutes(-3) }], refund: async () => { throw new SquareGatewayError('unknown_outcome'); } });
  assert.equal(await submitRefund('existing-0', silent.deps), 'UNKNOWN');
  // Square has it under that key: the retry records Square's refund.
  const landed = harness({ refunds: [{ status: 'SUBMITTING', updatedAt: minutes(-3) }], refund: squareRefund('COMPLETED') });
  assert.equal(await submitRefund('existing-0', landed.deps), 'COMPLETED');
  assert.deepEqual([landed.refunds[0].status, landed.refunds[0].squareRefundId], ['COMPLETED', 'square-rfd_existing0']);
});

test('a first sender whose claim was taken over can no longer record FAILED', async (t) => {
  t.mock.method(console, 'error', () => {});
  let releaseFirst!: () => void;
  const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const h = harness({
    refund: async () => {
      if (h.calls.length === 1) await firstHeld;
      throw new SquareGatewayError('provider_error', 400);
    },
  });
  const { id } = await createRefundRequest(h.db as never, h.attempt, 2000, 'STAFF_CANCELLED', null);
  const first = submitRefund(id, h.deps);
  while (h.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));
  // Three minutes on, its claim looks dead: a retry takes over and is refused.
  h.setNow(minutes(3));
  assert.equal(await submitRefund(id, h.deps), 'UNKNOWN');
  releaseFirst();
  assert.equal(await first, 'UNKNOWN', 'the first send may have made it too: not provably refused');
  assert.equal(h.refunds[0].status, 'UNKNOWN');
});

// Phase S4: following an accepted refund to its end, forward only.
test('a refund only moves forward: an older notice never undoes a newer state', () => {
  assert.equal(isRefundProgress('REQUESTED', 'PENDING'), true);
  assert.equal(isRefundProgress('SUBMITTING', 'PENDING'), true, 'a notice can arrive before its sender records the answer');
  assert.equal(isRefundProgress('SUBMITTING', 'COMPLETED'), true);
  assert.equal(isRefundProgress('PENDING', 'SUBMITTING'), false);
  assert.equal(isRefundProgress('UNKNOWN', 'COMPLETED'), true);
  assert.equal(isRefundProgress('PENDING', 'REJECTED'), true);
  assert.equal(isRefundProgress('PENDING', 'PENDING'), false);
  assert.equal(isRefundProgress('COMPLETED', 'PENDING'), false);
  assert.equal(isRefundProgress('FAILED', 'COMPLETED'), false);
  assert.equal(isRefundProgress('PENDING', 'SOMETHING_SQUARE_ADDS_LATER'), false);
  // Retries stopped, but Square's own word still settles it; a refund staff
  // settled by hand is final.
  assert.equal(isRefundProgress('UNRESOLVED', 'PENDING'), true);
  assert.equal(isRefundProgress('UNRESOLVED', 'COMPLETED'), true);
  assert.equal(isRefundProgress('SETTLED_EXTERNALLY', 'COMPLETED'), false);
});

test('followRefund asks Square about an accepted refund and records how it ended — its own refund only', async (t) => {
  t.mock.method(console, 'error', () => {});
  const answer = (overrides: Partial<SquareRefund> = {}): SquareRefund => ({
    id: 'sq-1', payment_id: 'payment-1', location_id: 'location-1', status: 'COMPLETED', amount_money: { amount: 2000, currency: 'GBP' }, ...overrides,
  });
  const run = async (refundRow: Partial<Refund>, respond: () => Promise<SquareRefund>, options: { noGateway?: boolean } = {}) => {
    const h = harness({ refunds: [{ status: 'PENDING', squareRefundId: 'sq-1', ...refundRow }] });
    const asked: string[] = [];
    const deps = { db: h.db as never, gatewayFor: () => (options.noGateway ? null : { getRefund: async (id: string) => { asked.push(id); return respond(); } }) };
    return { status: await followRefund('existing-0', deps), row: h.refunds[0], asked };
  };
  const completed = await run({}, async () => answer());
  assert.deepEqual([completed.status, completed.row.status, completed.asked], ['COMPLETED', 'COMPLETED', ['sq-1']]);
  assert.equal((await run({}, async () => answer({ status: 'REJECTED' }))).row.status, 'REJECTED');
  // Still pending, not this deposit's refund, or Square unreachable: nothing recorded.
  assert.equal((await run({}, async () => answer({ status: 'PENDING' }))).row.status, 'PENDING');
  assert.equal((await run({}, async () => answer({ payment_id: 'payment-2' }))).row.status, 'PENDING');
  assert.equal((await run({}, async () => answer({ amount_money: { amount: 1000, currency: 'GBP' } }))).row.status, 'PENDING');
  assert.equal((await run({}, async () => { throw new SquareGatewayError('unknown_outcome'); })).row.status, 'PENDING');
  // Not accepted yet (it is resubmitted instead), or another environment's: Square is not asked.
  const requested = await run({ status: 'REQUESTED', squareRefundId: null }, async () => answer());
  assert.deepEqual([requested.status, requested.asked], ['REQUESTED', []]);
  const elsewhere = await run({}, async () => answer(), { noGateway: true });
  assert.deepEqual([elsewhere.row.status, elsewhere.asked], ['PENDING', []]);
});

// Review W-C (c): a refund Square never confirmed is handed to staff. Once the
// customer has the money back another way — in the Square Dashboard, or in
// cash — staff record that, and the website never sends that refund again.
test('staff can mark an unanswered refund settled outside the website: audited, still counted, never sent again', async () => {
  const ids = ['a', 'b', 'c', 'd'];
  const store = paymentsDb({
    now: () => NOW,
    appointments: ids.map((id) => ({ id, status: 'CANCELLED', date: minutes(-24 * 60) })),
    attempts: ids.map((id) => attemptRow({ id, appointmentId: id, status: 'CAPTURED' })),
    refunds: [
      refundRow({ id: 'requested', attemptId: 'a', status: 'REQUESTED', updatedAt: minutes(-90) }),
      refundRow({ id: 'unknown', attemptId: 'b', status: 'UNKNOWN', updatedAt: minutes(-90) }),
      refundRow({ id: 'unresolved', attemptId: 'c', status: 'UNRESOLVED', updatedAt: minutes(-90) }),
      // Its sender went quiet more than 2 minutes ago.
      refundRow({ id: 'stuck', attemptId: 'd', status: 'SUBMITTING', updatedAt: minutes(-3) }),
    ],
  });
  const cases = [['a', 'requested', 'REQUESTED'], ['b', 'unknown', 'UNKNOWN'], ['c', 'unresolved', 'UNRESOLVED'], ['d', 'stuck', 'SUBMITTING']] as const;
  for (const [appointmentId, refundId] of cases) {
    assert.deepEqual(await settleRefundOutsideWebsite(store.db as never, { appointmentId, refundId, adminId: 'admin-1', now: NOW }), { kind: 'SETTLED', amountPence: 2000 }, refundId);
    assert.equal(store.tables.paymentRefund.find((row) => row.id === refundId)?.status, 'SETTLED_EXTERNALLY', refundId);
  }
  assert.deepEqual(
    store.tables.audit.map((row) => [row.action, row.actorUserId, row.targetType, row.targetId, row.metadata]),
    cases.map(([appointmentId, refundId, from]) => [
      'PAYMENT.REFUND_SETTLED_OUTSIDE', 'admin-1', 'PaymentRefund', refundId, { appointment: appointmentId, attempt: appointmentId, from, amountPence: 2000 },
    ]),
  );
  // Counted as given back: never refundable again, never sent to Square.
  for (const id of ids) assert.equal(await refundableRemainderPence(store.db as never, id), 0, id);
  const asked: unknown[] = [];
  const deps = { db: store.db as never, gatewayFor: () => ({ refund: async (input: unknown) => { asked.push(input); throw new Error('never asked'); } }), now: () => NOW };
  for (const [, refundId] of cases) assert.equal(await submitRefund(refundId, deps as never), 'SETTLED_EXTERNALLY');
  assert.deepEqual(asked, []);
  // Staff and the customer see it given back.
  assert.deepEqual(depositView({ status: 'CAPTURED', amountPence: 2000, refunds: [{ status: 'SETTLED_EXTERNALLY', amountPence: 2000 }] }), { state: 'REFUNDED', amountPence: 2000 });
});

test('a refund being sent right now, one Square has answered, or another booking’s cannot be marked settled', async () => {
  const answered = ['PENDING', 'COMPLETED', 'FAILED', 'REJECTED', 'SETTLED_EXTERNALLY'];
  const store = paymentsDb({
    now: () => NOW,
    appointments: [{ id: 'a', status: 'CANCELLED', date: minutes(-60) }, { id: 'b', status: 'CANCELLED', date: minutes(-60) }],
    attempts: [attemptRow({ id: 'a', appointmentId: 'a', status: 'CAPTURED' }), attemptRow({ id: 'b', appointmentId: 'b', status: 'CAPTURED' })],
    refunds: [
      refundRow({ id: 'sending', attemptId: 'a', status: 'SUBMITTING', updatedAt: minutes(-1) }),
      ...answered.map((status) => refundRow({ id: status.toLowerCase(), attemptId: 'b', status, squareRefundId: `sq-${status}` })),
    ],
  });
  const settle = (appointmentId: string, refundId: string) => settleRefundOutsideWebsite(store.db as never, { appointmentId, refundId, adminId: 'admin-1', now: NOW });
  assert.deepEqual(await settle('a', 'sending'), { kind: 'SENDING' }, 'its sender records Square\'s answer first');
  for (const status of answered) assert.deepEqual(await settle('b', status.toLowerCase()), { kind: 'ANSWERED', status }, status);
  assert.deepEqual(await settle('a', 'pending'), { kind: 'NOT_FOUND' }, 'another booking\'s refund');
  assert.deepEqual(await settle('a', 'missing'), { kind: 'NOT_FOUND' });
  assert.deepEqual(store.tables.paymentRefund.map((row) => row.status), ['SUBMITTING', ...answered]);
  assert.deepEqual(store.tables.audit, []);
});

test('marking a refund settled is conditional on the row as read: a change that lands meanwhile wins', async () => {
  const store = paymentsDb({
    now: () => NOW,
    appointments: [{ id: 'a', status: 'CANCELLED', date: minutes(-60) }],
    attempts: [attemptRow({ id: 'a', appointmentId: 'a', status: 'CAPTURED' })],
    refunds: [refundRow({ id: 'unknown', attemptId: 'a', status: 'UNKNOWN', updatedAt: minutes(-90) })],
  });
  // Square's notice (or a retry) moves the row just after it was read.
  const racing = {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => store.db.$transaction((tx) => fn({
      ...tx,
      paymentRefund: {
        ...tx.paymentRefund,
        findUnique: async (args: Parameters<typeof tx.paymentRefund.findUnique>[0]) => {
          const row = await tx.paymentRefund.findUnique(args);
          Object.assign(store.tables.paymentRefund[0], { status: 'PENDING', squareRefundId: 'sq-late', updatedAt: minutes(-1) });
          return row;
        },
      },
    })),
  };
  assert.deepEqual(await settleRefundOutsideWebsite(racing as never, { appointmentId: 'a', refundId: 'unknown', adminId: 'admin-1', now: NOW }), { kind: 'CHANGED' });
  assert.deepEqual([store.tables.paymentRefund[0].status, store.tables.audit], ['PENDING', []]);
});
