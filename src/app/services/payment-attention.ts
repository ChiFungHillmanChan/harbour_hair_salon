import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { OPERATIONS_MESSAGES } from './operations-messages';
import { REFUND_STATUSES_UNANSWERED, type PaymentRefundStatus } from './payment-refunds';

// Card deposits and refunds that need a person
// (docs/superpowers/specs/2026-10-13-square-deposits-design.md, phase S4) —
// what the booking actions, the Square webhook and reconciliation
// (payment-reconciliation.ts) could not settle by themselves. One set of
// rules for the daily "needs attention" email (ops-alert-service.ts) and
// Admin → Operations. Metadata only: ids, amounts, states and times — never
// who the customer is.

type AttentionDb = Pick<PrismaClient, 'paymentAttempt' | 'paymentRefund' | 'squareWebhookEvent'>;

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** Anything younger may still settle by itself (a retry, the next reconciliation). */
export const ATTENTION_AFTER_MS = HOUR;

/** Unanswered refunds whose wait is counted from their request (SUBMITTING, a send under way, from its last write). */
const UNANSWERED_BY_AGE: PaymentRefundStatus[] = REFUND_STATUSES_UNANSWERED.filter((status) => status !== 'SUBMITTING');

/** Square has not answered this refund for at least an hour (the rule of the query below). */
function unansweredLongEnough(refund: { status: string; createdAt: Date; updatedAt: Date }, settled: Date): boolean {
  if (refund.status === 'SUBMITTING') return refund.updatedAt < settled;
  return UNANSWERED_BY_AGE.includes(refund.status as PaymentRefundStatus) && refund.createdAt < settled;
}

/**
 * How far back the lists look. `declinesSince` also bounds the deposits Square
 * refused because of this website's own setup (the last 24 hours, both views).
 */
export type AttentionWindows = { failedRefundsSince: Date; lateCapturesSince: Date; notificationsSince: Date; declinesSince: Date };

/** The daily email: refund failures for a week, automatic late-capture refunds, unmatched notifications and card declines once. */
export function alertWindows(now: Date): AttentionWindows {
  return {
    failedRefundsSince: new Date(now.getTime() - 7 * DAY), lateCapturesSince: new Date(now.getTime() - DAY),
    notificationsSince: new Date(now.getTime() - DAY), declinesSince: new Date(now.getTime() - DAY),
  };
}

/** Admin → Operations: a longer look back (card declines: the same last 24 hours). */
export function pageWindows(now: Date): AttentionWindows {
  return {
    failedRefundsSince: new Date(now.getTime() - 30 * DAY), lateCapturesSince: new Date(now.getTime() - 7 * DAY),
    notificationsSince: new Date(now.getTime() - 30 * DAY), declinesSince: new Date(now.getTime() - DAY),
  };
}

/**
 * Card declines in a day worth the daily email (money-safety review I4): a
 * customer mistyping a card is ordinary; a run of declines can be someone
 * testing stolen cards. The website already stops card attempts after 3
 * declines per account or 5 per address a day (rate-limit.ts).
 */
export const DECLINES_WORTH_A_LOOK = 5;

/**
 * AWAITING_SQUARE: Square never answered (an authorization nobody is already
 * cancelling by key, a capture nobody saw finish, a submission that died).
 * TAKEN_NOT_CONFIRMED: taken for a request nobody has confirmed. TAKEN_ON_CANCELLED:
 * taken on a cancelled booking with no refund and no record of staff keeping
 * it. HOLD_NOT_RELEASED: a hold no booking wants that is still not released.
 */
export type AttemptProblem = 'AWAITING_SQUARE' | 'TAKEN_NOT_CONFIRMED' | 'TAKEN_ON_CANCELLED' | 'HOLD_NOT_RELEASED';
/**
 * FAILED: failed or rejected. UNCONFIRMED: Square has not answered it yet —
 * never sent, stuck being sent, or sent without a usable answer (including a
 * retry Square refused: the first send may have refunded, so it is never
 * FAILED). UNRESOLVED: Square never confirmed it within the automatic retry
 * window (payment-refunds.ts REFUND_RETRY_WINDOW_MS): nothing retries it any
 * more — staff check the Square Dashboard and, once the customer has the money
 * back, mark it settled outside the website. LATE_CAPTURE: an automatic full
 * refund of a deposit taken after its booking closed.
 */
export type RefundProblem = 'FAILED' | 'UNCONFIRMED' | 'UNRESOLVED' | 'LATE_CAPTURE';

export type AttemptAttention = {
  id: string; appointmentId: string | null; appointmentDate: Date | null; status: string; amountPence: number;
  since: Date; lastError: string | null; problem: AttemptProblem;
};
export type RefundAttention = {
  id: string; appointmentId: string | null; appointmentDate: Date | null; status: string; reason: string; amountPence: number;
  since: Date; problem: RefundProblem;
};
export type NotificationAttention = { eventId: string; type: string; objectId: string | null; receivedAt: Date };
/**
 * `declines`: deposit authorizations Square declined since `declinesSince`
 * (attempts that ended FAILED as declined — the card). `setupRefusals`: ones
 * Square refused in that time because of this website's own Square setup
 * (401/403/404…: access token, permissions, location — never the card).
 */
export type PaymentAttention = {
  attempts: AttemptAttention[]; refunds: RefundAttention[]; notifications: NotificationAttention[]; declines: number; setupRefusals: number;
};

export async function collectPaymentAttention(db: AttentionDb, now: Date, windows: AttentionWindows, take = 50): Promise<PaymentAttention> {
  const settled = new Date(now.getTime() - ATTENTION_AFTER_MS);
  const [attempts, refunds, notifications, declines, setupRefusals] = await Promise.all([
    db.paymentAttempt.findMany({
      where: {
        OR: [
          { status: { in: ['INITIATED', 'CAPTURING', 'CAPTURE_UNKNOWN'] }, updatedAt: { lt: settled } },
          // UNKNOWN that reconciliation is already cancelling by key every day needs nobody.
          {
            status: 'UNKNOWN', updatedAt: { lt: settled },
            OR: [{ lastError: null }, { lastError: { not: OPERATIONS_MESSAGES.PAYMENT_UNKNOWN_CANCELLING } }],
          },
          { status: 'CAPTURED', appointment: { is: { status: 'PENDING' } } },
          { status: 'CAPTURED', appointment: { is: { status: 'CANCELLED' } }, refunds: { none: {} } },
          {
            status: 'AUTHORIZED', updatedAt: { lt: settled },
            OR: [{ appointmentId: null }, { appointment: { is: { status: { not: 'PENDING' } } } }],
          },
        ],
      },
      select: {
        id: true, appointmentId: true, status: true, amountPence: true, updatedAt: true, lastError: true,
        appointment: { select: { status: true, date: true } },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take,
    }),
    db.paymentRefund.findMany({
      where: {
        OR: [
          { status: { in: ['FAILED', 'REJECTED'] }, updatedAt: { gte: windows.failedRefundsSince } },
          // Unanswered for an hour since it was requested: every retry dates the
          // row (updatedAt = last tried), which must not hide it again.
          { status: { in: UNANSWERED_BY_AGE }, createdAt: { lt: settled } },
          // A send under way is its sender's; one quiet for an hour is stuck.
          { status: 'SUBMITTING', updatedAt: { lt: settled } },
          // Handed to staff after the automatic retries: listed until they settle it.
          { status: 'UNRESOLVED' },
          { reason: 'LATE_CAPTURE', createdAt: { gte: windows.lateCapturesSince } },
        ],
      },
      select: {
        id: true, amountPence: true, status: true, reason: true, createdAt: true, updatedAt: true,
        attempt: { select: { appointmentId: true, appointment: { select: { date: true } } } },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take,
    }),
    db.squareWebhookEvent.findMany({
      where: { processedAt: null, receivedAt: { lt: settled, gte: windows.notificationsSince } },
      select: { eventId: true, type: true, objectId: true, receivedAt: true },
      orderBy: [{ receivedAt: 'desc' }, { eventId: 'asc' }],
      take,
    }),
    // Declined authorizations, however they were learnt (the submission, a
    // notice, reconciliation); a deposit never sent is not a decline.
    db.paymentAttempt.count({ where: { status: 'FAILED', lastError: OPERATIONS_MESSAGES.PAYMENT_DECLINED, updatedAt: { gte: windows.declinesSince } } }),
    // Refused by Square because of this website's own setup: a configuration problem.
    db.paymentAttempt.count({ where: { status: 'FAILED', lastError: OPERATIONS_MESSAGES.PAYMENT_SETUP_REFUSED, updatedAt: { gte: windows.declinesSince } } }),
  ]);
  return {
    attempts: attempts.map((row) => ({
      id: row.id, appointmentId: row.appointmentId, appointmentDate: row.appointment?.date ?? null, status: row.status,
      amountPence: row.amountPence, since: row.updatedAt, lastError: row.lastError,
      problem: row.status === 'CAPTURED' ? (row.appointment?.status === 'PENDING' ? 'TAKEN_NOT_CONFIRMED' : 'TAKEN_ON_CANCELLED')
        : row.status === 'AUTHORIZED' ? 'HOLD_NOT_RELEASED' : 'AWAITING_SQUARE',
    })),
    refunds: refunds.map((row) => {
      const problem: RefundProblem = row.status === 'FAILED' || row.status === 'REJECTED' ? 'FAILED'
        : row.status === 'UNRESOLVED' ? 'UNRESOLVED'
        : unansweredLongEnough(row, settled) ? 'UNCONFIRMED' : 'LATE_CAPTURE';
      return {
        id: row.id, appointmentId: row.attempt.appointmentId, appointmentDate: row.attempt.appointment?.date ?? null, status: row.status,
        reason: row.reason, amountPence: row.amountPence,
        // How long the customer has been waiting for it; a failure, since it failed.
        since: problem === 'UNCONFIRMED' || problem === 'UNRESOLVED' ? row.createdAt : row.updatedAt,
        problem,
      };
    }),
    notifications,
    declines,
    setupRefusals,
  };
}

/** How many of each, for the daily email. */
export type PaymentAttentionCounts = {
  /** Deposits Square refused in the last day because of this website's Square setup: raised from one (nobody can pay). */
  squareSetupRefused: number;
  awaitingSquare: number; takenNotConfirmed: number; takenOnCancelled: number; holdsNotReleased: number;
  refundsFailed: number;
  /** Refunds Square never confirmed within REFUND_RETRY_WINDOW_MS: automatic retries stopped, staff decide. */
  refundsUnresolved: number;
  refundsUnconfirmed: number; lateCaptures: number;
  /** Card declines in the last day, once there are DECLINES_WORTH_A_LOOK or more (else 0: an ordinary day). */
  cardDeclines: number;
  unmatchedNotifications: number;
};

export function countPaymentAttention(attention: PaymentAttention): PaymentAttentionCounts {
  const attempts = (problem: AttemptProblem) => attention.attempts.filter((row) => row.problem === problem).length;
  const refunds = (problem: RefundProblem) => attention.refunds.filter((row) => row.problem === problem).length;
  return {
    squareSetupRefused: attention.setupRefusals,
    awaitingSquare: attempts('AWAITING_SQUARE'),
    takenNotConfirmed: attempts('TAKEN_NOT_CONFIRMED'),
    takenOnCancelled: attempts('TAKEN_ON_CANCELLED'),
    holdsNotReleased: attempts('HOLD_NOT_RELEASED'),
    refundsFailed: refunds('FAILED'),
    refundsUnresolved: refunds('UNRESOLVED'),
    refundsUnconfirmed: refunds('UNCONFIRMED'),
    // Every automatic late-capture refund is reported, whatever its state.
    lateCaptures: attention.refunds.filter((row) => row.reason === 'LATE_CAPTURE').length,
    cardDeclines: attention.declines >= DECLINES_WORTH_A_LOOK ? attention.declines : 0,
    unmatchedNotifications: attention.notifications.length,
  };
}
