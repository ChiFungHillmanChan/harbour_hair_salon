import 'server-only';
import type { Prisma } from '@prisma/client';
import { usableSquareConfig } from '@/app/lib/online-booking-lock';
import { describeFault } from '@/app/lib/fault';
import { BookingError, type BookingErrorCode } from './booking-errors';
import type { DepositOutcome } from './email-content';
import { OPERATIONS_MESSAGES } from './operations-messages';
import { createPaymentAttemptService, isCaptureStale, type CaptureOrigin, type PaymentAttemptStatus } from './payment-attempts';
import { createRefundRequest, refundableRemainderPence, submitRefund, type PaymentRefundStatus, type RefundReason } from './payment-refunds';
import { createSquareGateway } from './square-gateway';

// The money side of a booking after its card deposit is held
// (docs/superpowers/specs/2026-10-13-square-deposits-design.md, phase S3):
// staff confirming the request TAKE (capture) the deposit; declining,
// withdrawing or lapsing it RELEASE (void) the hold; cancelling a confirmed
// booking REFUNDS what was taken — or keeps it: staff may choose to, and a
// customer cancelling less than DEPOSIT_REFUND_NOTICE_HOURS ahead does
// (actions/booking.ts cancelAppointment). The booking
// actions (actions/admin.ts, actions/booking.ts) and the lapse step
// (pending-request-lapse.ts) call these around their own transactions:
//   - the in-transaction parts only read and write rows, never Square, so a
//     retried Serializable transaction never repeats a money movement;
//   - Square is asked before the confirming transaction (capture) or after a
//     closing one has committed (release, refund).
//
// One rule keeps an approval and a closing from racing: an attempt only
// becomes CAPTURING in a transaction that has just seen its request PENDING,
// and every closing refuses (DEPOSIT_IN_PROGRESS) while it is CAPTURING or
// CAPTURE_UNKNOWN — until it has been quiet for CAPTURE_STALE_MS, when
// Square's word on it is final and it is settled first. So whoever holds
// CAPTURING owns the money until it is recorded, and a closing that committed
// while the deposit was AUTHORIZED can release it afterwards: nothing can
// start taking it any more. A deposit staff keep on cancelling is recorded
// KEPT, so nothing later reads it as money taken without a reason.

/** A booking's deposit, as the lifecycle reads it. */
export const linkedDepositSelect = {
  id: true, appointmentId: true, status: true, amountPence: true, squarePaymentId: true,
  delayedUntil: true, environment: true, locationId: true, updatedAt: true,
} satisfies Prisma.PaymentAttemptSelect;
export type LinkedDeposit = Prisma.PaymentAttemptGetPayload<{ select: typeof linkedDepositSelect }>;

type AttemptDb = Pick<Prisma.TransactionClient, 'paymentAttempt'>;
type DepositDb = Pick<Prisma.TransactionClient, 'paymentAttempt' | 'paymentRefund'>;

/** The deposit tied to a booking, if it has one. */
export function loadLinkedDeposit(db: AttemptDb, appointmentId: string): Promise<LinkedDeposit | null> {
  return db.paymentAttempt.findUnique({ where: { appointmentId }, select: linkedDepositSelect });
}

/**
 * The Square gateway for money a deposit already holds, or null: only with
 * this deployment's usable configuration (usableSquareConfig: switched off or
 * incomplete counts as none; a production build uses production credentials
 * only, everything else sandbox only), and only in the Square environment and
 * location the deposit was taken in. A payment id is never sent to another
 * environment, and a preview — which runs on a copy of the production
 * database — never moves production money.
 */
export function depositGatewayFor(attempt: { environment: string; locationId: string }) {
  const config = usableSquareConfig();
  if (!config || config.environment !== attempt.environment || config.locationId !== attempt.locationId) return null;
  return createSquareGateway({ loadConfig: async () => config });
}

function paymentsFor(db: AttemptDb, attempt: { environment: string; locationId: string }, now?: () => Date) {
  const gateway = depositGatewayFor(attempt);
  return gateway ? createPaymentAttemptService({ db, gateway, ...(now ? { now } : {}) }) : null;
}

// --- Confirming a request: take the deposit ---------------------------------

/**
 * What confirming a request does with its deposit:
 *  - NONE: it has none (deposit 0, staff-entered, older bookings): confirm as always;
 *  - CAPTURE: take it — a valid hold, or a capture to finish (Square is read first);
 *  - CONFIRM: already taken (an earlier approval could not save its
 *    confirmation): confirm without touching money.
 */
export type ApprovalStep = 'NONE' | 'CAPTURE' | 'CONFIRM';

/**
 * Whether a request's deposit lets staff confirm it now, and how — or why
 * not. A hold that has run out (or that Square no longer has) can never be
 * confirmed online: the customer would be told "deposit paid" with nothing taken.
 */
export function approvalStep(attempt: Pick<LinkedDeposit, 'status' | 'delayedUntil' | 'updatedAt'> | null, now: Date): ApprovalStep | BookingErrorCode {
  if (!attempt) return 'NONE';
  switch (attempt.status as PaymentAttemptStatus) {
    case 'AUTHORIZED':
      return attempt.delayedUntil && attempt.delayedUntil.getTime() > now.getTime() ? 'CAPTURE' : 'DEPOSIT_HOLD_EXPIRED';
    case 'CAPTURE_UNKNOWN':
      return 'CAPTURE';
    case 'CAPTURING':
      // Another approval is taking it — unless that one died.
      return isCaptureStale(attempt, now) ? 'CAPTURE' : 'DEPOSIT_IN_PROGRESS';
    case 'CAPTURED':
      return 'CONFIRM';
    default:
      // VOIDED, EXPIRED, FAILED, UNKNOWN, INITIATED: no hold to take.
      return 'DEPOSIT_HOLD_EXPIRED';
  }
}

export type DepositClaim =
  | { kind: 'NONE' }
  | { kind: 'CONFIRM'; attempt: LinkedDeposit }
  | { kind: 'CAPTURE'; attempt: LinkedDeposit; origin: CaptureOrigin };

/**
 * Inside the approval's first transaction, after its own checks (still
 * PENDING, not started, calendars ready, the time still free): claim the
 * deposit for this approval, AUTHORIZED (or an unfinished capture) →
 * CAPTURING, conditionally — of two staff confirming at once only one ever
 * takes it; the other is refused (DEPOSIT_IN_PROGRESS). Throws the
 * BookingError that refuses the approval.
 */
export async function claimDepositForCapture(tx: AttemptDb, appointmentId: string, now: Date): Promise<DepositClaim> {
  const attempt = await loadLinkedDeposit(tx, appointmentId);
  const step = approvalStep(attempt, now);
  if (step === 'NONE' || !attempt) return { kind: 'NONE' };
  if (step === 'CONFIRM') return { kind: 'CONFIRM', attempt };
  if (step !== 'CAPTURE') throw new BookingError(step);
  const claimed = await tx.paymentAttempt.updateMany({
    where: { id: attempt.id, status: attempt.status, updatedAt: attempt.updatedAt },
    // updatedAt dates the claim: see CAPTURE_STALE_MS.
    data: { status: 'CAPTURING', updatedAt: now },
  });
  if (claimed.count !== 1) throw new BookingError('DEPOSIT_IN_PROGRESS');
  // Anything but a fresh hold may already have been taken: read Square first.
  const origin: CaptureOrigin = attempt.status === 'AUTHORIZED' ? 'AUTHORIZED' : 'CAPTURE_UNKNOWN';
  return { kind: 'CAPTURE', attempt: { ...attempt, status: 'CAPTURING', updatedAt: now }, origin };
}

/**
 * Between the approval's two transactions, outside both: take the claimed
 * deposit (payment-attempts.ts `capture`). 'CAPTURED', or the BookingErrorCode
 * refusing the approval; every other outcome is already recorded on the attempt.
 */
export async function takeDeposit(db: AttemptDb, attempt: LinkedDeposit, origin: CaptureOrigin): Promise<'CAPTURED' | BookingErrorCode> {
  const payments = paymentsFor(db, attempt);
  if (!payments) {
    // Switched off since the check before the claim: nothing was sent.
    try {
      await db.paymentAttempt.updateMany({ where: { id: attempt.id, status: 'CAPTURING' }, data: { status: origin } });
    } catch (error) {
      console.error('Restoring a deposit claim failed', { attemptId: attempt.id, ...describeFault(error) });
    }
    return 'DEPOSIT_PAYMENTS_UNAVAILABLE';
  }
  switch (await payments.capture(attempt, origin)) {
    case 'CAPTURED': return 'CAPTURED';
    case 'EXPIRED': return 'DEPOSIT_HOLD_EXPIRED';
    case 'UNCONFIRMED': return 'DEPOSIT_CAPTURE_UNKNOWN';
    case 'UNAVAILABLE': return 'DEPOSIT_PAYMENTS_UNAVAILABLE';
    default: return 'DEPOSIT_CAPTURE_FAILED';
  }
}

/**
 * Inside the transaction that confirms the request (or, its time lost,
 * cancels it): the deposit is recorded taken. Throws when the attempt is no
 * longer this approval's to record, which rolls that transaction back.
 */
export async function markDepositCaptured(tx: AttemptDb, attempt: Pick<LinkedDeposit, 'id' | 'status'>, now: Date): Promise<void> {
  if (attempt.status === 'CAPTURED') {
    // Taken earlier, by an approval that could not save its confirmation.
    await tx.paymentAttempt.updateMany({ where: { id: attempt.id, status: 'CAPTURED' }, data: { lastError: null } });
    return;
  }
  const marked = await tx.paymentAttempt.updateMany({
    where: { id: attempt.id, status: 'CAPTURING' },
    data: { status: 'CAPTURED', capturedAt: now, lastError: null },
  });
  if (marked.count !== 1) throw new Error('The taken deposit could not be recorded');
}

/**
 * The deposit was taken but the confirming transaction failed: record it
 * taken (best effort, never throws), so confirming again finishes without
 * touching money and closing the request refunds it. If even this fails the
 * claim goes stale and the next approval or closing reads Square.
 */
export async function recordDepositTakenNotConfirmed(db: AttemptDb, attemptId: string, now: Date): Promise<void> {
  try {
    await db.paymentAttempt.updateMany({
      where: { id: attemptId, status: 'CAPTURING' },
      data: { status: 'CAPTURED', capturedAt: now, lastError: OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED },
    });
  } catch (error) {
    console.error('Recording a taken deposit failed', { attemptId, ...describeFault(error) });
  }
}

// --- Closing a booking: release, refund or keep ------------------------------

/** What became of a booking's deposit when it closed — for its email (email-content.ts) and the audit. */
export type { DepositOutcome };

export type DepositPlan = {
  outcome: DepositOutcome | null;
  amountPence: number;
  /** The deposit for the email snapshot (notification-outbox-service.ts), as it was when the booking closed. */
  paymentAttempt: { status: string; amountPence: number } | null;
  /** After the commit: the hold to release. */
  releaseAttemptId: string | null;
  /** After the commit: the refund to ask Square for. */
  refundId: string | null;
};

export const NO_DEPOSIT: DepositPlan = { outcome: null, amountPence: 0, paymentAttempt: null, releaseAttemptId: null, refundId: null };

/**
 * Before the transaction that closes a booking (declined, withdrawn,
 * cancelled, marked completed, lapsed): find out what became of a capture
 * nobody saw finish, so the closing knows whether the deposit was taken. Null
 * when the closing may go ahead; DEPOSIT_IN_PROGRESS while a capture is under
 * way or still settling (CAPTURING or CAPTURE_UNKNOWN younger than
 * CAPTURE_STALE_MS: a timed-out capture may yet land) or Square cannot say
 * yet. Square is asked only for such a deposit, and only once it is quiet.
 */
export async function settleDepositBeforeClosing(db: AttemptDb, appointmentId: string, now: Date): Promise<BookingErrorCode | null> {
  const attempt = await loadLinkedDeposit(db, appointmentId);
  if (!attempt || (attempt.status !== 'CAPTURING' && attempt.status !== 'CAPTURE_UNKNOWN')) return null;
  if (!isCaptureStale(attempt, now)) return 'DEPOSIT_IN_PROGRESS';
  const payments = paymentsFor(db, attempt, () => now);
  if (!payments) return 'DEPOSIT_IN_PROGRESS';
  const settled = await payments.settle(attempt);
  return settled === 'CAPTURED' || settled === 'AUTHORIZED' || settled === 'EXPIRED' ? null : 'DEPOSIT_IN_PROGRESS';
}

/**
 * Inside the transaction that closes a booking: what happens to its deposit.
 *  - A hold (AUTHORIZED) is released after the commit — or, already run out,
 *    recorded EXPIRED now (Square drops it by itself). Either way the
 *    customer is told it is released.
 *  - A deposit taken (CAPTURED) is refunded in full when the booking is
 *    cancelled — a REQUESTED refund row now, Square after the commit — unless
 *    `refund` is false: staff keep it, or the customer cancelled less than
 *    DEPOSIT_REFUND_NOTICE_HOURS ahead; recorded on the deposit itself
 *    (CAPTURED → KEPT, conditionally). Marked completed, it is kept as part
 *    of the bill and stays CAPTURED.
 *  - A capture under way refuses the closing (DEPOSIT_IN_PROGRESS).
 *  - Anything else held nothing.
 */
export async function planDepositForClosing(tx: DepositDb, appointmentId: string, options: {
  closing: 'CANCEL' | 'COMPLETE';
  /** CANCEL only: refund a taken deposit (false: keep it). */
  refund: boolean;
  reason: RefundReason;
  /** The administrator closing it; null for the customer or the system. */
  requestedById: string | null;
  now: Date;
}): Promise<DepositPlan> {
  const attempt = await loadLinkedDeposit(tx, appointmentId);
  if (!attempt || attempt.amountPence <= 0) return NO_DEPOSIT;
  const held = { status: attempt.status, amountPence: attempt.amountPence };
  switch (attempt.status as PaymentAttemptStatus) {
    case 'CAPTURING':
    case 'CAPTURE_UNKNOWN':
      throw new BookingError('DEPOSIT_IN_PROGRESS');
    case 'AUTHORIZED': {
      const released = { ...NO_DEPOSIT, outcome: 'RELEASED' as const, amountPence: attempt.amountPence, paymentAttempt: held };
      if (attempt.delayedUntil && attempt.delayedUntil.getTime() > options.now.getTime()) return { ...released, releaseAttemptId: attempt.id };
      await tx.paymentAttempt.updateMany({ where: { id: attempt.id, status: 'AUTHORIZED' }, data: { status: 'EXPIRED', lastError: OPERATIONS_MESSAGES.PAYMENT_HOLD_EXPIRED } });
      return released;
    }
    case 'CAPTURED': {
      if (options.closing === 'COMPLETE') return { ...NO_DEPOSIT, paymentAttempt: held };
      const remainder = await refundableRemainderPence(tx, attempt.id);
      if (remainder <= 0) return { ...NO_DEPOSIT, paymentAttempt: held };
      if (!options.refund) {
        // A deliberate keep (a cancellation less than DEPOSIT_REFUND_NOTICE_HOURS
        // ahead or a no-show, as the booking terms say): recorded, so the attention list never reports it as
        // money taken without a reason and reconciliation never refunds it as
        // a late capture. Conditional: a concurrent change rolls this closing back.
        const kept = await tx.paymentAttempt.updateMany({ where: { id: attempt.id, status: 'CAPTURED' }, data: { status: 'KEPT' } });
        if (kept.count !== 1) throw new Error('The kept deposit could not be recorded');
        return { ...NO_DEPOSIT, outcome: 'KEPT', amountPence: remainder, paymentAttempt: held };
      }
      const refund = await createRefundRequest(tx, attempt, remainder, options.reason, options.requestedById);
      return { ...NO_DEPOSIT, outcome: 'REFUNDING', amountPence: refund.amountPence, paymentAttempt: held, refundId: refund.id };
    }
    case 'VOIDED':
    case 'EXPIRED':
      // Already released, or dropped by Square.
      return { ...NO_DEPOSIT, outcome: 'RELEASED', amountPence: attempt.amountPence, paymentAttempt: held };
    default:
      return NO_DEPOSIT;
  }
}

/**
 * After the closing has committed: release the hold, or ask Square for the
 * refund. Never throws — what fails is left on the rows for reconciliation
 * (and Square drops an untaken hold by itself when it runs out).
 */
export async function settleDepositAfterCommit(db: DepositDb, plan: Pick<DepositPlan, 'releaseAttemptId' | 'refundId'>): Promise<void> {
  if (plan.releaseAttemptId) await releaseDepositHold(db, plan.releaseAttemptId);
  if (plan.refundId) await submitDepositRefund(db, plan.refundId);
}

/**
 * Release (void) a deposit hold that is still held (payment-attempts.ts
 * `release`). Without a usable gateway it is marked for reconciliation
 * instead. Never throws.
 */
export async function releaseDepositHold(db: AttemptDb, attemptId: string): Promise<boolean> {
  try {
    const attempt = await db.paymentAttempt.findUnique({ where: { id: attemptId }, select: linkedDepositSelect });
    if (!attempt || attempt.status !== 'AUTHORIZED') return false;
    const payments = paymentsFor(db, attempt);
    if (payments) return await payments.release(attempt);
    await db.paymentAttempt.updateMany({ where: { id: attemptId, status: 'AUTHORIZED' }, data: { lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED } });
    return false;
  } catch (error) {
    console.error('Releasing a deposit hold failed', { attemptId, ...describeFault(error) });
    return false;
  }
}

/** Ask Square for a refund already requested (payment-refunds.ts submitRefund). Never throws. */
export function submitDepositRefund(db: DepositDb, refundId: string): Promise<PaymentRefundStatus | null> {
  return submitRefund(refundId, { db, gatewayFor: depositGatewayFor });
}
