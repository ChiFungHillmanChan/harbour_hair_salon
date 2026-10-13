import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { appendAuditEvent } from '@/app/lib/audit';
import { SETTLEABLE_REFUND_STATUSES } from '@/app/lib/deposit-display';
import { describeFault } from '@/app/lib/fault';
import { SquareGatewayError, type createSquareGateway } from './square-gateway';

// Refunds of a TAKEN (captured) deposit
// (docs/superpowers/specs/2026-10-13-square-deposits-design.md, "Cancel a
// confirmed booking — refund"). The PaymentRefund row is written in the same
// transaction that cancels the booking, with its own idempotency key; Square
// is asked only after that commits, always with the row's key and always the
// same request (the payment, the amount and the key — no free text a deploy
// could change), so asking again — after a timeout, a crash, or by
// reconciliation (S4) — can only ever return that same refund, never a second.
//
//   REQUESTED → SUBMITTING → PENDING → COMPLETED   (Square accepted it; banks take days)
//                          ↘ COMPLETED | FAILED | REJECTED (Square's own answer)
//                          ↘ FAILED   (Square refused the FIRST send: nothing exists under the key)
//                          ↘ UNKNOWN  (no usable answer: retried with the same key)
//                          ↘ REQUESTED (never left this server: still unsent)
//   SUBMITTING, its sender quiet for REFUND_SUBMIT_STALE_MS → UNKNOWN (a retry from then on)
//   UNKNOWN → PENDING | COMPLETED | FAILED | REJECTED (Square's answer to a retry);
//             Square REFUSING a retry proves nothing — the first send may have
//             refunded — so it stays UNKNOWN (each try touches the row, so the
//             daily batch, oldest-tried first, rotates), listed for staff
//   UNKNOWN / stale SUBMITTING, REFUND_RETRY_WINDOW_MS after the refund was
//             requested → UNRESOLVED (the daily run stops retrying; staff decide).
//             Square's own notice can still move it on (PENDING / COMPLETED / …)
//   REQUESTED / UNKNOWN / UNRESOLVED / stale SUBMITTING → SETTLED_EXTERNALLY
//             (staff refunded the customer themselves: Square Dashboard or cash)
//
// FAILED makes a deposit refundable again (refundableRemainderPence), so it is
// only ever recorded where no refund can exist: Square's own FAILED, or a
// refusal of the send that provably went first (the REQUESTED → SUBMITTING
// claim, which only one sender can win and which happens before any call).
// UNRESOLVED and SETTLED_EXTERNALLY stay counted, so a deposit is never
// refunded twice automatically; neither is ever sent to Square again.
// An uncaptured hold is never refunded: it is released (payment-attempts.ts).
// A PENDING refund reaches its end through the Square webhook
// (square-webhook-events.ts) or `followRefund` below (reconciliation).

/**
 * Why a deposit is refunded (the PaymentRefund.reason column; Admin →
 * Operations translates it — Square is never sent it). LATE_CAPTURE: Square
 * took a deposit whose booking had already closed (or was never made) —
 * payment-reconciliation.ts refunds it in full. REQUEST_LAPSED: a deposit was
 * taken for a request nobody confirmed before its appointment ended —
 * pending-request-lapse.ts closes it and refunds it in full.
 */
export type RefundReason = 'CUSTOMER_CANCELLED' | 'STAFF_CANCELLED' | 'SLOT_LOST' | 'LATE_CAPTURE' | 'REQUEST_LAPSED';

/** Every refund reason, in a stable order (Admin → Operations translates them). */
export const REFUND_REASONS: readonly RefundReason[] = ['CUSTOMER_CANCELLED', 'STAFF_CANCELLED', 'SLOT_LOST', 'LATE_CAPTURE', 'REQUEST_LAPSED'];

/**
 * Every state a PaymentRefund row can be in (the column is a plain string).
 * UNRESOLVED: Square never confirmed it within REFUND_RETRY_WINDOW_MS, so
 * nothing retries it any more and staff are told. SETTLED_EXTERNALLY: staff
 * recorded that the customer was refunded another way (the Square Dashboard,
 * or cash) — never sent to Square again.
 */
export type PaymentRefundStatus =
  | 'REQUESTED' | 'SUBMITTING' | 'PENDING' | 'COMPLETED' | 'FAILED' | 'REJECTED' | 'UNKNOWN' | 'UNRESOLVED' | 'SETTLED_EXTERNALLY';

/** Refunds that have returned money, or still may: every state but FAILED and REJECTED. */
export const REFUND_STATUSES_COUNTED: readonly PaymentRefundStatus[] = ['REQUESTED', 'SUBMITTING', 'PENDING', 'COMPLETED', 'UNKNOWN', 'UNRESOLVED', 'SETTLED_EXTERNALLY'];

/**
 * Refunds Square has not answered for: never sent (REQUESTED), being sent
 * (SUBMITTING) or sent without a usable answer (UNKNOWN). submitRefund asks
 * again with the row's own key; payment-attention.ts lists them an hour after
 * they were requested (a SUBMITTING one, an hour after its last write).
 */
export const REFUND_STATUSES_UNANSWERED: readonly PaymentRefundStatus[] = ['REQUESTED', 'SUBMITTING', 'UNKNOWN'];

/**
 * Refunds a Square refund notice may still be matched to by payment and amount
 * (square-webhook-events.ts): the unanswered ones, and those the daily run
 * stopped retrying — Square's own word on them still counts.
 */
export const REFUND_STATUSES_MATCHABLE: readonly PaymentRefundStatus[] = [...REFUND_STATUSES_UNANSWERED, 'UNRESOLVED'];

/**
 * How long the daily run keeps re-sending a refund Square has not confirmed
 * before handing it to staff (UNRESOLVED). Counted from the refund's
 * `createdAt`: it is written in the closing transaction and first sent right
 * after the commit (or by the next daily run if that send never happened), so
 * this is its first send, give or take a day at most — and a later first
 * send only ever shortens the window, never lengthens it. A refund never sent
 * (REQUESTED) is provably unsent, so sending it is always safe: it is never
 * given up on.
 */
export const REFUND_RETRY_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** A refund sent at least once that Square has still not confirmed after REFUND_RETRY_WINDOW_MS: time to stop retrying it. */
export function isRefundRetryWindowOver(refund: { status: string; createdAt: Date }, now: Date): boolean {
  return (refund.status === 'UNKNOWN' || refund.status === 'SUBMITTING')
    && refund.createdAt.getTime() <= now.getTime() - REFUND_RETRY_WINDOW_MS;
}

/**
 * How long a refund may stay SUBMITTING before its sender is presumed gone and
 * the row is retried as UNKNOWN. A sender makes one Square call, which times
 * out after 10 seconds.
 */
export const REFUND_SUBMIT_STALE_MS = 2 * 60_000;

/** A SUBMITTING claim old enough to take over (see REFUND_SUBMIT_STALE_MS). */
export function isRefundSubmitStale(refund: { status: string; updatedAt: Date }, now: Date): boolean {
  return refund.status === 'SUBMITTING' && refund.updatedAt.getTime() <= now.getTime() - REFUND_SUBMIT_STALE_MS;
}

type RefundDb = Pick<Prisma.TransactionClient, 'paymentAttempt' | 'paymentRefund'>;
type RefundGateway = Pick<ReturnType<typeof createSquareGateway>, 'refund'>;
type RefundLookupGateway = Pick<ReturnType<typeof createSquareGateway>, 'getRefund'>;

/**
 * A new refund's Square idempotency key: `rfd_` and a UUID's 32 hex digits —
 * 36 characters of [a-z0-9_], inside Square's 45. Stored on the row and reused
 * for every retry of that refund.
 */
export function refundIdempotencyKey(): string {
  return `rfd_${randomUUID().replace(/-/g, '')}`;
}

/**
 * How much of a deposit can still be refunded: what was taken, less every
 * refund that has returned money or still may. Zero unless it was taken and
 * not kept (CAPTURED) — a hold is released, never refunded, and a deposit
 * staff kept on cancelling (KEPT) is theirs to give back by hand if ever.
 */
export async function refundableRemainderPence(db: RefundDb, attemptId: string): Promise<number> {
  const attempt = await db.paymentAttempt.findUnique({ where: { id: attemptId }, select: { status: true, amountPence: true } });
  if (!attempt || attempt.status !== 'CAPTURED') return 0;
  const refunds = await db.paymentRefund.findMany({
    where: { attemptId, status: { in: [...REFUND_STATUSES_COUNTED] } },
    select: { amountPence: true },
  });
  return Math.max(0, attempt.amountPence - refunds.reduce((sum, refund) => sum + refund.amountPence, 0));
}

/**
 * Write a REQUESTED refund, inside the transaction that cancels the booking.
 * Refuses (throws, so that transaction rolls back) anything above what is
 * still refundable — never more than was taken, less what is already
 * refunded or on its way. `requestedById`: the administrator, or null for the
 * customer or the system.
 */
export async function createRefundRequest(
  tx: RefundDb,
  attempt: { id: string },
  amountPence: number,
  reason: RefundReason,
  requestedById: string | null,
): Promise<{ id: string; amountPence: number; idempotencyKey: string }> {
  if (!Number.isSafeInteger(amountPence) || amountPence <= 0) throw new Error('A refund must be a positive whole number of pence');
  const remainder = await refundableRemainderPence(tx, attempt.id);
  if (amountPence > remainder) throw new Error('A refund cannot exceed the deposit taken less what is already refunded');
  return tx.paymentRefund.create({
    data: { attemptId: attempt.id, idempotencyKey: refundIdempotencyKey(), amountPence, status: 'REQUESTED', reason, requestedById },
    select: { id: true, amountPence: true, idempotencyKey: true },
  });
}

/**
 * Ask Square for a refund the database already holds — after the
 * cancellation has committed, outside every transaction, with the row's own
 * key and the same request every time (so it is safe to repeat). The first
 * send is claimed (REQUESTED → SUBMITTING) before Square is called; a send
 * whose sender went quiet (SUBMITTING for REFUND_SUBMIT_STALE_MS) is taken
 * over as UNKNOWN; a fresh SUBMITTING is left to its sender. Records Square's
 * answer: PENDING, COMPLETED, FAILED or REJECTED; FAILED when Square refused
 * the first send; UNKNOWN when it gave no usable answer, or refused a retry
 * (reconciliation asks again with the same key, and staff are told).
 * With payments switched off here — or for a deposit taken in another Square
 * environment or location — nothing is sent and the row is left as it was.
 * Returns the row's state afterwards (null: no such row, or the database
 * failed). Never throws.
 */
export async function submitRefund(
  refundId: string,
  deps: {
    db: RefundDb;
    gatewayFor: (attempt: { environment: string; locationId: string }) => RefundGateway | null;
    now?: () => Date;
  },
): Promise<PaymentRefundStatus | null> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const read = () => db.paymentRefund.findUnique({
    where: { id: refundId },
    select: {
      id: true, status: true, amountPence: true, idempotencyKey: true, updatedAt: true,
      attempt: { select: { id: true, status: true, squarePaymentId: true, environment: true, locationId: true } },
    },
  });
  /** The row's state as it is now (null: gone, or the database failed). */
  const current = async (): Promise<PaymentRefundStatus | null> => {
    try {
      return ((await read())?.status ?? null) as PaymentRefundStatus | null;
    } catch (error) {
      console.error('Reading a deposit refund failed', { refundId, ...describeFault(error) });
      return null;
    }
  };

  let refund;
  try {
    refund = await read();
  } catch (error) {
    console.error('Reading a deposit refund failed', { refundId, ...describeFault(error) });
    return null;
  }
  if (!refund) return null;
  let from = refund.status as PaymentRefundStatus;
  // A send under way belongs to its sender, which records Square's answer.
  if (from === 'SUBMITTING' && !isRefundSubmitStale(refund, now())) return from;
  if (from !== 'REQUESTED' && from !== 'SUBMITTING' && from !== 'UNKNOWN') return from;
  const paymentId = refund.attempt.squarePaymentId;
  if (refund.attempt.status !== 'CAPTURED' || !paymentId) {
    console.error('A deposit refund has no taken payment to refund', { refundId });
    return from;
  }
  const gateway = deps.gatewayFor(refund.attempt);
  if (!gateway) return from;

  /** Conditional on the state it leaves, so a later writer (S4's webhook, reconciliation) is never overwritten. */
  const move = async (state: PaymentRefundStatus, data: Prisma.PaymentRefundUpdateManyMutationInput & { status: PaymentRefundStatus }) => {
    try {
      const moved = await db.paymentRefund.updateMany({ where: { id: refund.id, status: state }, data });
      if (moved.count === 1) return data.status;
    } catch (error) {
      console.error('Recording a deposit refund failed', { refundId, ...describeFault(error) });
      return state;
    }
    // Someone else moved it first (Square's notification, a retry): theirs stands.
    return current();
  };

  /**
   * A retry of an UNKNOWN refund that changed nothing (Square refused it, or
   * gave no usable answer): record the try itself — `updatedAt` is when it was
   * last tried — so the daily batch, oldest-tried first, moves on to the
   * others next time instead of asking about the same rows forever.
   * Conditional on the row as read; never throws.
   */
  const leaveTried = async (): Promise<PaymentRefundStatus | null> => {
    if (refund.status !== 'UNKNOWN') return from; // a claim already dated this try
    try {
      const touched = await db.paymentRefund.updateMany({ where: { id: refund.id, status: 'UNKNOWN', updatedAt: refund.updatedAt }, data: { updatedAt: now() } });
      if (touched.count === 1) return from;
    } catch (error) {
      console.error('Recording a deposit refund retry failed', { refundId, ...describeFault(error) });
      return from;
    }
    return current();
  };

  // Claim the send before Square is called. REQUESTED → SUBMITTING: this
  // key's first send, provably — only one claim can win, and nothing sends a
  // REQUESTED row unclaimed. A SUBMITTING row whose sender went quiet →
  // UNKNOWN: its send may have reached Square, so it is a retry from here on.
  let first = false;
  if (from === 'REQUESTED' || from === 'SUBMITTING') {
    const to: PaymentRefundStatus = from === 'REQUESTED' ? 'SUBMITTING' : 'UNKNOWN';
    try {
      const claimed = await db.paymentRefund.updateMany({
        where: { id: refund.id, status: from, ...(from === 'SUBMITTING' ? { updatedAt: refund.updatedAt } : {}) },
        data: { status: to },
      });
      if (claimed.count !== 1) return current();
    } catch (error) {
      console.error('Claiming a deposit refund failed', { refundId, ...describeFault(error) });
      return from;
    }
    first = from === 'REQUESTED';
    from = to;
  }

  try {
    // The payment, the amount and the row's key — nothing else, ever: a retry
    // with the same key must be the identical request, or Square refuses it
    // (IDEMPOTENCY_KEY_REUSED) even though the first one may have refunded.
    const result = await gateway.refund({ paymentId, amountPence: refund.amountPence, idempotencyKey: refund.idempotencyKey });
    // PENDING stays PENDING: accepted is not refunded.
    return move(from, { status: result.status, squareRefundId: result.id });
  } catch (error) {
    const kind = error instanceof SquareGatewayError ? error.kind : null;
    if (kind === 'disabled' || kind === 'invalid_input') {
      // Never left this server: a first send is still provably unsent.
      if (kind === 'invalid_input') console.error('A deposit refund could not be sent', { refundId });
      return first ? move('SUBMITTING', { status: 'REQUESTED' }) : leaveTried();
    }
    if (kind === 'provider_error') {
      // Square refused the very first request under this key: nothing exists.
      if (first) return move('SUBMITTING', { status: 'FAILED' });
      // Refusing a retry proves nothing (credentials changed, Square's own
      // state since): the first send may have refunded. Left UNKNOWN — never
      // FAILED, which would make the deposit refundable twice — with the try
      // recorded; listed for staff, and handed to them for good
      // (UNRESOLVED) once REFUND_RETRY_WINDOW_MS has passed.
      console.error('Square refused a deposit refund retry; it stays unconfirmed', { refundId, httpStatus: (error as SquareGatewayError).httpStatus });
      return leaveTried();
    }
    if (!kind) console.error('A deposit refund failed unexpectedly', { refundId, ...describeFault(error) });
    // A timeout, a 5xx or an unreadable answer: the refund may exist. Never a
    // new key — the same one asks for the same refund.
    return from === 'UNKNOWN' ? leaveTried() : move(from, { status: 'UNKNOWN' });
  }
}

/**
 * The daily run stops retrying a refund Square has not confirmed within
 * REFUND_RETRY_WINDOW_MS (isRefundRetryWindowOver): UNKNOWN or a stale
 * SUBMITTING → UNRESOLVED, conditional on the row exactly as read. Still
 * counted against the deposit, listed for staff until they settle it
 * (settleRefundOutsideWebsite), and never sent again — though Square's own
 * notice can still record its answer. Whether it moved.
 */
export async function markRefundUnresolved(db: Pick<RefundDb, 'paymentRefund'>, refund: { id: string; status: string; updatedAt: Date }): Promise<boolean> {
  if (refund.status !== 'UNKNOWN' && refund.status !== 'SUBMITTING') return false;
  const moved = await db.paymentRefund.updateMany({ where: { id: refund.id, status: refund.status, updatedAt: refund.updatedAt }, data: { status: 'UNRESOLVED' } });
  return moved.count === 1;
}

/**
 * What marking a refund settled outside the website did.
 *  - SETTLED: recorded SETTLED_EXTERNALLY (and audited).
 *  - NOT_FOUND: no such refund on this booking.
 *  - SENDING: a send is under way right now (SUBMITTING, its sender not yet
 *    quiet for REFUND_SUBMIT_STALE_MS): Square's answer comes first.
 *  - ANSWERED: Square has answered it (PENDING, COMPLETED, FAILED, REJECTED),
 *    or it is settled already: nothing to settle by hand.
 *  - CHANGED: it moved while being marked; look again.
 */
export type SettleOutsideOutcome =
  | { kind: 'SETTLED'; amountPence: number }
  | { kind: 'NOT_FOUND' }
  | { kind: 'SENDING' }
  | { kind: 'ANSWERED'; status: string }
  | { kind: 'CHANGED' };

/**
 * Admin → Schedule → "Mark refund as settled outside the website": staff
 * refunded the customer themselves (the Square Dashboard, or cash), so the
 * website must never send this refund to Square again. A refund Square has not
 * answered (REQUESTED, UNKNOWN, UNRESOLVED, or SUBMITTING whose sender went
 * quiet) → SETTLED_EXTERNALLY, which stays counted against the deposit (never
 * refunded twice) and stops every retry. One transaction: the conditional
 * write (on the row exactly as read: a send or a notice that lands meanwhile
 * wins) and its audit event. Square is not asked anything.
 */
export async function settleRefundOutsideWebsite(
  db: Pick<PrismaClient, '$transaction'>,
  input: { appointmentId: string; refundId: string; adminId: string; now: Date },
): Promise<SettleOutsideOutcome> {
  return db.$transaction(async (tx) => {
    const refund = await tx.paymentRefund.findUnique({
      where: { id: input.refundId },
      select: { id: true, status: true, amountPence: true, updatedAt: true, attemptId: true, attempt: { select: { appointmentId: true } } },
    });
    if (!refund || refund.attempt.appointmentId !== input.appointmentId) return { kind: 'NOT_FOUND' } as const;
    if (!SETTLEABLE_REFUND_STATUSES.includes(refund.status)) return { kind: 'ANSWERED', status: refund.status } as const;
    if (refund.status === 'SUBMITTING' && !isRefundSubmitStale(refund, input.now)) return { kind: 'SENDING' } as const;
    const moved = await tx.paymentRefund.updateMany({
      where: { id: refund.id, status: refund.status, updatedAt: refund.updatedAt },
      data: { status: 'SETTLED_EXTERNALLY' },
    });
    if (moved.count !== 1) return { kind: 'CHANGED' } as const;
    await appendAuditEvent({
      actorUserId: input.adminId, action: 'PAYMENT.REFUND_SETTLED_OUTSIDE', targetType: 'PaymentRefund', targetId: refund.id,
      metadata: { appointment: input.appointmentId, attempt: refund.attemptId, from: refund.status, amountPence: refund.amountPence },
    }, tx);
    return { kind: 'SETTLED', amountPence: refund.amountPence } as const;
  });
}

/**
 * How far along a refund is: not yet answered (REQUESTED, SUBMITTING,
 * UNKNOWN, and UNRESOLVED — retries stopped, Square's word still counts) <
 * accepted (PENDING) < final (COMPLETED, FAILED, REJECTED, and
 * SETTLED_EXTERNALLY — staff refunded it by hand). A refund only ever moves
 * forward: Square's notifications arrive in any order, so an older PENDING
 * never undoes a COMPLETED.
 */
const REFUND_PROGRESS: Record<PaymentRefundStatus, number> = {
  REQUESTED: 0, SUBMITTING: 0, UNKNOWN: 0, UNRESOLVED: 0, PENDING: 1, COMPLETED: 2, FAILED: 2, REJECTED: 2, SETTLED_EXTERNALLY: 2,
};

/** Whether Square's `to` moves a refund recorded as `from` forward. */
export function isRefundProgress(from: string, to: string): boolean {
  const before = REFUND_PROGRESS[from as PaymentRefundStatus];
  const after = REFUND_PROGRESS[to as PaymentRefundStatus];
  return before !== undefined && after !== undefined && after > before;
}

/**
 * Follow a refund Square has accepted (PENDING) to its end: ask Square for it
 * (GetRefund, outside every transaction) and record COMPLETED, FAILED or
 * REJECTED — conditionally, so a webhook that got there first is never
 * overwritten. Only in the Square environment and location the deposit was
 * taken in (`gatewayFor` returns null otherwise: nothing is asked). Returns
 * the row's state afterwards (null: no such row, or the database failed).
 * Never throws.
 */
export async function followRefund(
  refundId: string,
  deps: { db: RefundDb; gatewayFor: (attempt: { environment: string; locationId: string }) => RefundLookupGateway | null },
): Promise<PaymentRefundStatus | null> {
  let refund;
  try {
    refund = await deps.db.paymentRefund.findUnique({
      where: { id: refundId },
      select: {
        id: true, status: true, amountPence: true, squareRefundId: true,
        attempt: { select: { squarePaymentId: true, environment: true, locationId: true } },
      },
    });
  } catch (error) {
    console.error('Reading a deposit refund failed', { refundId, ...describeFault(error) });
    return null;
  }
  if (!refund) return null;
  const from = refund.status as PaymentRefundStatus;
  if (from !== 'PENDING' || !refund.squareRefundId) return from;
  const gateway = deps.gatewayFor(refund.attempt);
  if (!gateway) return from;
  try {
    const seen = await gateway.getRefund(refund.squareRefundId);
    // Square's refund for this row: same payment, same amount.
    if (seen.payment_id !== refund.attempt.squarePaymentId || seen.amount_money.amount !== refund.amountPence) {
      console.error('A deposit refund does not match what Square holds', { refundId });
      return from;
    }
    if (!isRefundProgress(from, seen.status)) return from;
    await deps.db.paymentRefund.updateMany({ where: { id: refund.id, status: from }, data: { status: seen.status } });
    return seen.status;
  } catch (error) {
    if (!(error instanceof SquareGatewayError)) console.error('Following a deposit refund failed', { refundId, ...describeFault(error) });
    return from;
  }
}
