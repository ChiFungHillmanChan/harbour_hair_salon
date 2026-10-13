import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { appendAuditEvent } from '@/app/lib/audit';
import { describeFault } from '@/app/lib/fault';
import { usableSquareConfig } from '@/app/lib/online-booking-lock';
import type { SquareConfig } from '@/app/lib/square-config';
import { depositGatewayFor } from './deposit-lifecycle';
import { OPERATIONS_MESSAGES } from './operations-messages';
import { createPaymentAttemptService } from './payment-attempts';
import {
  createRefundRequest, followRefund, isRefundRetryWindowOver, markRefundUnresolved, REFUND_STATUSES_UNANSWERED, refundableRemainderPence, submitRefund,
  type PaymentRefundStatus,
} from './payment-refunds';
import type { createSquareGateway, SquarePayment } from './square-gateway';
import { heldWithoutBooking, inThisDeployment, markSquareEventProcessed, SUBMISSION_IN_FLIGHT_MS } from './square-webhook-events';

// Reconciliation (docs/superpowers/specs/2026-10-13-square-deposits-design.md,
// phase S4): whatever the booking actions and the Square webhook could not
// settle by themselves is settled here by asking Square afresh — once a day
// in the existing housekeeping run (no cron of its own: CLAUDE.md "Neon
// compute budget"), on demand from Admin → Schedule → "Re-check payment",
// and right after a webhook that says Square holds or took money no booking
// wants. The rules S2/S3 follow hold here too:
//   - Square is never called inside a database transaction;
//   - every write is conditional on the row as it was read (forward only);
//   - only deposits of THIS deployment's Square environment and location are
//     asked about, through the guarded gateway (deposit-lifecycle.ts
//     depositGatewayFor): preview deployments run on a copy of production data;
//   - money only moves towards the customer — a hold no booking wants is
//     released, a deposit taken after its booking closed is refunded in full —
//     and a deposit taken for a request that is still open is recorded taken
//     (CAPTURED, flagged PAYMENT_CAPTURED_NOT_CONFIRMED) and left to staff
//     (confirming keeps it and never takes it twice; declining refunds it);
//   - a deposit staff kept when they cancelled (KEPT) is a decision, not an
//     unexplained capture: it is never refunded here.
// What still needs a person is listed by payment-attention.ts (Admin →
// Operations and the daily "needs attention" email).

type Gateway = ReturnType<typeof createSquareGateway>;
export type ReconciliationDb = Pick<PrismaClient, 'paymentAttempt' | 'paymentRefund' | 'squareWebhookEvent' | 'auditEvent' | '$transaction'>;
type Deployment = Pick<SquareConfig, 'environment' | 'locationId'>;

export type ReconciliationDeps = {
  db: ReconciliationDb;
  /** This deployment's usable Square configuration, or null (nothing is asked). */
  config: Deployment | null;
  /** The guarded gateway for a deposit's own environment and location (depositGatewayFor), or null. */
  gatewayFor: (attempt: { environment: string; locationId: string }) => Gateway | null;
  now?: () => Date;
  /** Milliseconds, for the daily run's time budget. */
  clock?: () => number;
};

/**
 * The daily run leaves alone anything this young: a submission, an approval,
 * a release or a refund may still be on its way (every Square call times out
 * after 10 seconds; S3 takes over a capture claim after 2 minutes).
 */
export const RECONCILE_MIN_AGE_MS = 15 * 60_000;
/** A refund Square has accepted (PENDING) is asked about again once it is this old. */
export const FOLLOW_REFUND_AFTER_MS = 60 * 60_000;
/**
 * Square drops an uncaptured online hold within 7 days (delay_action CANCEL).
 * Until then an authorization nobody heard back about is cancelled by its key
 * again every day — Square answers {} even when nothing matched YET, and a
 * slow authorization can still land — and only then is it settled.
 */
export const HOLD_LIFETIME_MS = 7 * 24 * 60 * 60_000;
const BATCH = 20;
/** The daily run stops starting new checks after this long (housekeeping's maxDuration bounds it). */
const BUDGET_MS = 25_000;

const attemptSelect = {
  id: true, status: true, amountPence: true, squarePaymentId: true, idempotencyKey: true, environment: true, locationId: true,
  lastError: true, createdAt: true, updatedAt: true, appointmentId: true, appointment: { select: { status: true } },
} satisfies Prisma.PaymentAttemptSelect;
type Attempt = Prisma.PaymentAttemptGetPayload<{ select: typeof attemptSelect }>;

/** What checking one deposit found. */
type Facts = {
  /** Nothing more is owed for this payment: Square answered and every release or record it needed happened. */
  settled: boolean;
  /** Square was asked and answered (false: unreachable, or switched off here). */
  reached: boolean;
  /** Square has taken the deposit while its booking is still open: staff decide. */
  squareTaken: boolean;
  /** Square's payment is not this deposit's (amount or reference): left alone and flagged. */
  mismatch: boolean;
  /** The full refund requested because Square took a deposit no booking keeps. */
  lateCaptureRefundId: string | null;
};
const SETTLED: Facts = { settled: true, reached: true, squareTaken: false, mismatch: false, lateCaptureRefundId: null };
const UNREACHED: Facts = { ...SETTLED, settled: false, reached: false };
const OPEN: Facts = { ...SETTLED, settled: false };

/** Thrown inside the late-capture transaction to roll it back when there is nothing to refund. */
class NothingToRefund extends Error {}

export type ReconciliationSummary = {
  /** No usable Square configuration here: nothing was read or asked. */
  skipped: boolean;
  /** Deposits, refunds and notifications looked at. */
  checked: number;
  /** Deposits taken after their booking closed, now being refunded in full. */
  lateCaptureRefunds: number;
  /** Checked but not settled: Square unreachable, a release that failed, or something for staff. */
  unresolved: number;
  /** Steps that threw (logged by name and code). */
  failed: number;
  /** The time budget ran out; the rest waits for the next run. */
  outOfTime: boolean;
};

/** A booking's deposit after "Re-check payment" (deposit-recheck-copy.ts words it). */
export type DepositCheckState =
  | 'HELD' | 'HOLD_ENDED' | 'RELEASE_PENDING' | 'RELEASED' | 'PAID' | 'KEPT' | 'TAKEN_NOT_CONFIRMED' | 'TAKEN_ON_CANCELLED'
  | 'LATE_CAPTURE' | 'IN_PROGRESS' | 'UNCONFIRMED' | 'MISMATCH';

export type DepositRecheck =
  | { kind: 'NONE' }
  | { kind: 'UNAVAILABLE'; status: string }
  | {
    kind: 'CHECKED';
    state: DepositCheckState;
    amountPence: number;
    /** Square answered everything asked of it. */
    reached: boolean;
    refunds: { status: string; amountPence: number }[];
    before: { status: string; refunds: string[] };
    after: { status: string; refunds: string[] };
  };

export function createPaymentReconciliation(deps: ReconciliationDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const clock = deps.clock ?? Date.now;
  const refundDeps = { db, gatewayFor: deps.gatewayFor, now };
  /** Square has not answered for this refund yet (or the database could not say). */
  const unanswered = (status: PaymentRefundStatus | null) => status === null || REFUND_STATUSES_UNANSWERED.includes(status);

  /** The row exactly as it was read: anyone who moved it since wins. */
  const exact = (attempt: Attempt) => ({ id: attempt.id, status: attempt.status, updatedAt: attempt.updatedAt });
  const write = async (where: Prisma.PaymentAttemptWhereInput, data: Prisma.PaymentAttemptUpdateManyMutationInput) =>
    Object.keys(data).length > 0 && (await db.paymentAttempt.updateMany({ where, data })).count === 1;
  const load = (where: Prisma.PaymentAttemptWhereUniqueInput) => db.paymentAttempt.findUnique({ where, select: attemptSelect });

  /**
   * Square took money no booking keeps — the request closed (its hold was
   * meant to be released) or was never booked: record it taken and refund it
   * in full, in one transaction (the refund row, an audit event), then ask
   * Square for the refund with the row's own key, after the commit. Never a
   * second refund: never more than what was taken less what is already refunded.
   */
  async function refundLateCapture(attempt: Attempt, paymentId: string | null): Promise<string | null> {
    let refund: { id: string };
    try {
      refund = await db.$transaction(async (tx) => {
        const marked = await tx.paymentAttempt.updateMany({
          where: exact(attempt),
          data: {
            status: 'CAPTURED', lastError: OPERATIONS_MESSAGES.PAYMENT_LATE_CAPTURE_REFUNDED,
            ...(attempt.status === 'CAPTURED' ? {} : { capturedAt: now() }),
            ...(attempt.squarePaymentId === null && paymentId ? { squarePaymentId: paymentId } : {}),
          },
        });
        if (marked.count !== 1) throw new NothingToRefund();
        const remainder = await refundableRemainderPence(tx, attempt.id);
        if (remainder <= 0) throw new NothingToRefund();
        const created = await createRefundRequest(tx, attempt, remainder, 'LATE_CAPTURE', null);
        await appendAuditEvent({
          actorUserId: null, action: 'PAYMENT.LATE_CAPTURE_REFUND', targetType: 'PaymentAttempt', targetId: attempt.id,
          metadata: { from: attempt.status, appointment: attempt.appointmentId, depositPence: remainder },
        }, tx);
        return created;
      });
    } catch (error) {
      if (error instanceof NothingToRefund) return null;
      throw error;
    }
    await submitRefund(refund.id, refundDeps);
    return refund.id;
  }

  /** The deposit was settled as taken (payment-attempts.ts `settle`): what that means for its booking. */
  async function afterCaptureSettled(attemptId: string): Promise<Facts> {
    const attempt = await load({ id: attemptId });
    if (!attempt || attempt.status !== 'CAPTURED') return SETTLED;
    const booking = attempt.appointment?.status;
    if (booking === 'CONFIRMED' || booking === 'COMPLETED') {
      if (attempt.lastError === OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED) await write(exact(attempt), { lastError: null });
      return SETTLED;
    }
    // Taken, its request not confirmed: flagged (PAYMENT_CAPTURED_NOT_CONFIRMED) — staff decide.
    if (booking === 'PENDING') return { ...SETTLED, squareTaken: true };
    // Closed while the capture was unanswered, or never booked: give it back.
    return { ...SETTLED, lateCaptureRefundId: await refundLateCapture(attempt, attempt.squarePaymentId) };
  }

  /**
   * Make one deposit agree with what Square says NOW (`payment`, just read).
   * Releases a hold no booking wants, records what Square settled, refunds a
   * deposit taken after its booking closed; leaves a hold its request needs,
   * and a deposit taken for a still-open request, to staff.
   */
  async function act(attempt: Attempt, payment: SquarePayment, gateway: Gateway): Promise<Facts> {
    // Square's payment for this deposit: its reference (the attempt id), amount and — once known — id.
    if (payment.reference_id !== attempt.id || payment.amount_money.amount !== attempt.amountPence
      || (attempt.squarePaymentId !== null && payment.id !== attempt.squarePaymentId)) {
      if (attempt.lastError !== OPERATIONS_MESSAGES.PAYMENT_MISMATCH) await write(exact(attempt), { lastError: OPERATIONS_MESSAGES.PAYMENT_MISMATCH });
      return { ...OPEN, mismatch: true };
    }
    const learnId = attempt.squarePaymentId === null ? { squarePaymentId: payment.id } : {};
    const booking = attempt.appointment?.status;
    // Being taken, taken, or taken and kept by staff: Square holding it as
    // COMPLETED is expected — never a late capture to refund.
    const unclaimed = !['CAPTURING', 'CAPTURE_UNKNOWN', 'CAPTURED', 'KEPT'].includes(attempt.status);
    switch (payment.status) {
      case 'APPROVED': {
        // A hold its request still needs, one still in its submission's hands,
        // or one being taken: nothing to do.
        if (!heldWithoutBooking(attempt, now())) return SETTLED;
        if (attempt.status === 'AUTHORIZED') {
          const released = await createPaymentAttemptService({ db, gateway, now }).release(
            { id: attempt.id, amountPence: attempt.amountPence, squarePaymentId: payment.id },
            attempt.appointmentId === null ? OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED : null,
          );
          return released ? SETTLED : OPEN;
        }
        // UNKNOWN, VOIDED, FAILED, EXPIRED or an abandoned INITIATED: this site
        // holds nothing, so Square must not either.
        try {
          await gateway.cancel({ paymentId: payment.id, amountPence: attempt.amountPence, referenceId: attempt.id });
        } catch {
          return UNREACHED;
        }
        await write(exact(attempt), attempt.status === 'UNKNOWN' || attempt.status === 'INITIATED'
          ? { status: 'VOIDED', voidedAt: now(), lastError: OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED, ...learnId }
          : {
            ...(attempt.lastError === OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED ? { lastError: OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED } : {}),
            // Recorded expired by its date; now released for certain.
            ...(attempt.lastError === OPERATIONS_MESSAGES.PAYMENT_HOLD_EXPIRED ? { lastError: null } : {}),
            ...learnId,
          });
        return SETTLED;
      }
      case 'COMPLETED': {
        if (!unclaimed) return SETTLED;
        if (attempt.status === 'INITIATED' && !heldWithoutBooking(attempt, now())) return OPEN;
        if (booking === 'PENDING') {
          if (attempt.status === 'AUTHORIZED') {
            // Taken while this site still recorded a hold, its request still
            // open: recorded taken — conditionally, exactly as settle()
            // records a capture nobody saw finish — and flagged
            // (PAYMENT_CAPTURED_NOT_CONFIRMED, listed TAKEN_NOT_CONFIRMED). A
            // decline now refunds it at once, with the refund email, instead
            // of "releasing" money already taken; confirming finishes without
            // touching money. The booking itself is never changed here.
            const recorded = await write(exact(attempt), {
              status: 'CAPTURED', capturedAt: now(), lastError: OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED, ...learnId,
            });
            return { ...SETTLED, settled: recorded, squareTaken: true };
          }
          // Taken although this site had let it go (or never heard back): a person checks.
          return { ...OPEN, squareTaken: true };
        }
        if (booking === 'CONFIRMED') {
          if (attempt.status !== 'AUTHORIZED') return { ...OPEN, squareTaken: true };
          await write(exact(attempt), { status: 'CAPTURED', capturedAt: now(), lastError: null, ...learnId });
          return SETTLED;
        }
        // The booking closed (its hold was to be released) or was never made.
        const refundId = await refundLateCapture(attempt, payment.id);
        return refundId ? { ...SETTLED, lateCaptureRefundId: refundId } : { ...SETTLED, settled: false };
      }
      case 'CANCELED':
      case 'FAILED': {
        if (attempt.status === 'AUTHORIZED') {
          // An open request lost its hold (the lapse step closes it); a closed
          // or never-booked one has been released as wanted.
          await write(exact(attempt), booking === 'PENDING' || booking === 'CONFIRMED'
            ? { status: 'EXPIRED', lastError: OPERATIONS_MESSAGES.PAYMENT_HOLD_CANCELLED }
            : { status: 'VOIDED', voidedAt: now(), lastError: attempt.appointmentId === null ? OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED : null });
          return SETTLED;
        }
        if (attempt.status === 'INITIATED' && !heldWithoutBooking(attempt, now())) return OPEN;
        if (attempt.status === 'UNKNOWN' || attempt.status === 'INITIATED') {
          await write(exact(attempt), payment.status === 'FAILED'
            ? { status: 'FAILED', lastError: OPERATIONS_MESSAGES.PAYMENT_DECLINED, ...learnId }
            : { status: 'VOIDED', voidedAt: now(), lastError: OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED, ...learnId });
          return SETTLED;
        }
        if (attempt.status === 'VOIDED' && attempt.lastError === OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED) {
          await write(exact(attempt), { lastError: OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED, ...learnId });
        }
        if (attempt.status === 'EXPIRED' && attempt.lastError === OPERATIONS_MESSAGES.PAYMENT_HOLD_EXPIRED) {
          // Recorded expired by its date (S3, without asking Square): now Square confirms it.
          await write(exact(attempt), { lastError: OPERATIONS_MESSAGES.PAYMENT_HOLD_CANCELLED });
        }
        return SETTLED;
      }
      default:
        // PENDING: Square has not decided yet; ask again next time.
        return OPEN;
    }
  }

  /**
   * An authorization nobody heard back about, with no Square payment id:
   * cancel it by its key, again every day until any hold it could have
   * placed has run out (HOLD_LIFETIME_MS), then settle it VOIDED.
   */
  async function cancelByKey(attempt: Attempt, gateway: Gateway): Promise<Facts> {
    const byKey = attempt.status === 'INITIATED' || attempt.status === 'UNKNOWN'
      || (attempt.status === 'VOIDED' && attempt.lastError === OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED);
    if (attempt.appointmentId !== null || !byKey) return SETTLED;
    const age = now().getTime() - attempt.createdAt.getTime();
    // Still its own submission's to finish (which cancels by key itself).
    if (age < SUBMISSION_IN_FLIGHT_MS) return OPEN;
    if (age >= HOLD_LIFETIME_MS) {
      if (attempt.status !== 'VOIDED') {
        await write(exact(attempt), { status: 'VOIDED', voidedAt: now(), lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED });
      }
      return SETTLED;
    }
    try {
      await gateway.cancelByIdempotencyKey(attempt.idempotencyKey);
    } catch {
      return UNREACHED;
    }
    // Asked; not proof. It stays UNKNOWN (or VOIDED-by-key) and is asked again tomorrow.
    if (attempt.status !== 'VOIDED' && !(attempt.status === 'UNKNOWN' && attempt.lastError === OPERATIONS_MESSAGES.PAYMENT_UNKNOWN_CANCELLING)) {
      await write(exact(attempt), { status: 'UNKNOWN', lastError: OPERATIONS_MESSAGES.PAYMENT_UNKNOWN_CANCELLING });
    }
    return OPEN;
  }

  /** Check one deposit with Square (outside any transaction). */
  async function checkAttempt(attempt: Attempt): Promise<Facts> {
    const gateway = deps.config && inThisDeployment(attempt, deps.config) ? deps.gatewayFor(attempt) : null;
    if (!gateway) return UNREACHED;
    // Taken (and recorded), or taken and kept by staff: nothing to ask Square.
    if (attempt.status === 'CAPTURED' || attempt.status === 'KEPT') return SETTLED;
    if (attempt.status === 'CAPTURE_UNKNOWN' || attempt.status === 'CAPTURING') {
      // A capture nobody saw finish: S3's own settle (claims it, reads Square,
      // records taken / still held / dropped); a fresh claim is left to its approval.
      const outcome = await createPaymentAttemptService({ db, gateway, now }).settle(attempt);
      if (outcome === 'CAPTURED') return afterCaptureSettled(attempt.id);
      if (outcome === 'BUSY') return OPEN;
      return outcome === 'UNCONFIRMED' ? UNREACHED : SETTLED;
    }
    if (!attempt.squarePaymentId) return cancelByKey(attempt, gateway);
    let payment: SquarePayment;
    try {
      payment = await gateway.getPayment(attempt.squarePaymentId);
    } catch {
      return UNREACHED;
    }
    return act(attempt, payment, gateway);
  }

  /**
   * A Square notification still open (the webhook asked for a fresh check,
   * or never matched): read the payment and settle what it says. Refund
   * notifications are settled once their refund row knows Square's id (the
   * refund checks below ask Square with the row's own key).
   */
  async function reconcileEvent(event: { eventId: string; type: string; objectId: string | null }): Promise<boolean> {
    const config = deps.config;
    if (!config || !event.objectId) return false;
    if (event.type.startsWith('refund.')) {
      const known = await db.paymentRefund.findUnique({ where: { squareRefundId: event.objectId }, select: { id: true } });
      if (known) await markSquareEventProcessed(db, event.eventId, now());
      return Boolean(known);
    }
    const gateway = deps.gatewayFor(config);
    if (!gateway) return false;
    let payment: SquarePayment;
    try {
      payment = await gateway.getPayment(event.objectId);
    } catch {
      return false;
    }
    const attempt = await load({ squarePaymentId: payment.id })
      ?? (payment.reference_id ? await load({ id: payment.reference_id }) : null);
    if (!attempt || !inThisDeployment(attempt, config)) return false;
    const facts = attempt.status === 'CAPTURE_UNKNOWN' || attempt.status === 'CAPTURING'
      ? await checkAttempt(attempt)
      : await act(attempt, payment, gateway);
    if (facts.settled) await markSquareEventProcessed(db, event.eventId, now());
    return facts.settled;
  }

  return {
    checkAttempt,
    reconcileEvent,

    /** The webhook's follow-up: the open notification `eventId`, checked with Square now. */
    async reconcileEventById(eventId: string): Promise<boolean> {
      const event = await db.squareWebhookEvent.findUnique({ where: { eventId }, select: { eventId: true, type: true, objectId: true, processedAt: true } });
      if (!event) return false;
      if (event.processedAt) return true;
      return reconcileEvent(event);
    },

    /**
     * The daily run (housekeeping): every phase bounded, every row isolated —
     * a failure is logged and the rest goes on; the next run picks it up.
     */
    async reconcileAll(): Promise<ReconciliationSummary> {
      const summary: ReconciliationSummary = { skipped: false, checked: 0, lateCaptureRefunds: 0, unresolved: 0, failed: 0, outOfTime: false };
      const config = deps.config;
      // Before any database access: nothing can be asked of Square here.
      if (!config) return { ...summary, skipped: true };
      const started = clock();
      const at = now().getTime();
      const ago = (ms: number) => new Date(at - ms);
      const mine = { environment: config.environment, locationId: config.locationId };
      const tally = (facts: Facts) => {
        summary.checked++;
        if (facts.lateCaptureRefundId) summary.lateCaptureRefunds++;
        if (!facts.settled) summary.unresolved++;
      };
      async function phase<T>(name: string, rows: () => Promise<T[]>, check: (row: T) => Promise<void>) {
        if (summary.outOfTime) return;
        let due: T[];
        try {
          due = await rows();
        } catch (error) {
          summary.failed++;
          console.error('Payment reconciliation could not read its work', { phase: name, ...describeFault(error) });
          return;
        }
        for (const row of due) {
          if (clock() - started > BUDGET_MS) {
            summary.outOfTime = true;
            return;
          }
          try {
            await check(row);
          } catch (error) {
            summary.failed++;
            console.error('Payment reconciliation step failed', { phase: name, ...describeFault(error) });
          }
        }
      }
      const attempts = (where: Prisma.PaymentAttemptWhereInput) =>
        db.paymentAttempt.findMany({ where: { ...mine, ...where }, select: attemptSelect, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: BATCH });
      const checkEach = async (attempt: Attempt) => tally(await checkAttempt(attempt));

      // Captures nobody saw finish: unanswered, or claimed long ago.
      await phase('captures', () => attempts({
        OR: [{ status: 'CAPTURE_UNKNOWN' }, { status: 'CAPTURING', updatedAt: { lt: ago(RECONCILE_MIN_AGE_MS) } }],
      }), checkEach);
      // Holds no booking wants: never booked, or the request closed (declined,
      // withdrawn, lapsed, cancelled, completed) and its release failed or ran
      // out of time.
      await phase('holds', () => attempts({
        status: 'AUTHORIZED', updatedAt: { lt: ago(RECONCILE_MIN_AGE_MS) },
        OR: [{ appointmentId: null }, { appointment: { is: { status: { not: 'PENDING' } } } }],
      }), checkEach);
      // Holds S3 recorded EXPIRED by their date alone (a lapse or closing after
      // `delayedUntil`, Square not asked): confirmed with Square once — released
      // if Square still holds it, refunded in full if a capture landed after all.
      await phase('expiries', () => attempts({
        status: 'EXPIRED', lastError: OPERATIONS_MESSAGES.PAYMENT_HOLD_EXPIRED,
        updatedAt: { lt: ago(RECONCILE_MIN_AGE_MS), gte: ago(HOLD_LIFETIME_MS) },
      }), checkEach);
      // Authorizations nobody heard back about (and the ones cancelled by key
      // while a hold could still land).
      await phase('authorizations', () => attempts({
        appointmentId: null, createdAt: { lt: ago(SUBMISSION_IN_FLIGHT_MS) },
        OR: [
          { status: { in: ['INITIATED', 'UNKNOWN'] } },
          { status: 'VOIDED', lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED, createdAt: { gte: ago(HOLD_LIFETIME_MS) } },
        ],
      }), checkEach);
      // Refunds Square has not answered — never sent, sent without an answer,
      // or stuck SUBMITTING (its sender went quiet; every such row is well past
      // REFUND_SUBMIT_STALE_MS here, so it is retried as UNKNOWN): asked again
      // with the row's own key and the same payload, which returns the
      // original refund if it exists. A retry Square refuses stays UNKNOWN,
      // and every try is dated on its row (`updatedAt`), so the batch takes
      // the least recently tried first and rotates through them all. Once
      // REFUND_RETRY_WINDOW_MS has passed since the refund was requested, one
      // that was sent is no longer retried: UNRESOLVED, for staff (never a
      // REQUESTED one — provably unsent, always safe to send).
      await phase('refunds', () => db.paymentRefund.findMany({
        where: { status: { in: [...REFUND_STATUSES_UNANSWERED] }, updatedAt: { lt: ago(RECONCILE_MIN_AGE_MS) }, attempt: { is: mine } },
        select: { id: true, status: true, createdAt: true, updatedAt: true }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: BATCH,
      }), async (row) => {
        if (isRefundRetryWindowOver(row, now())) {
          await markRefundUnresolved(db, row);
          // Handed to staff (payment-attention.ts): still needs a person.
          tally(OPEN);
          return;
        }
        const status = await submitRefund(row.id, refundDeps);
        tally({ ...SETTLED, settled: !unanswered(status) });
      });
      // Refunds Square accepted: followed to COMPLETED, FAILED or REJECTED.
      await phase('pendingRefunds', () => db.paymentRefund.findMany({
        where: { status: 'PENDING', updatedAt: { lt: ago(FOLLOW_REFUND_AFTER_MS) }, attempt: { is: mine } },
        select: { id: true }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: BATCH,
      }), async (row) => {
        const status = await followRefund(row.id, refundDeps);
        tally({ ...SETTLED, settled: status !== null && status !== 'PENDING' });
      });
      // Notifications still open (a fresh check that did not finish, or no match yet).
      await phase('notifications', () => db.squareWebhookEvent.findMany({
        where: { processedAt: null, receivedAt: { lt: ago(RECONCILE_MIN_AGE_MS), gte: ago(HOLD_LIFETIME_MS) } },
        select: { eventId: true, type: true, objectId: true }, orderBy: [{ receivedAt: 'asc' }, { eventId: 'asc' }], take: BATCH,
      }), async (event) => tally({ ...SETTLED, settled: await reconcileEvent(event) }));
      return summary;
    },

    /**
     * "Re-check payment" for one booking (Admin → Schedule): the same checks,
     * at once — no waiting period, since staff ask for it — for its deposit
     * and every refund of it; then what is true now. A refund handed to staff
     * (UNRESOLVED) or settled by them (SETTLED_EXTERNALLY) is reported, never
     * sent again: staff may already have refunded the customer by hand.
     */
    async recheckAppointment(appointmentId: string): Promise<DepositRecheck> {
      const refundSelect = { id: true, status: true, amountPence: true };
      const read = () => db.paymentAttempt.findUnique({
        where: { appointmentId },
        select: { ...attemptSelect, refunds: { select: refundSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
      });
      const before = await read();
      if (!before) return { kind: 'NONE' };
      if (!deps.config || !inThisDeployment(before, deps.config) || !deps.gatewayFor(before)) return { kind: 'UNAVAILABLE', status: before.status };
      const facts = await checkAttempt(before);
      let reached = facts.reached;
      for (const refund of before.refunds) {
        if (REFUND_STATUSES_UNANSWERED.includes(refund.status as PaymentRefundStatus)) {
          // A SUBMITTING one under 2 minutes old is left to its sender (submitRefund).
          const status = await submitRefund(refund.id, refundDeps);
          if (unanswered(status)) reached = false;
        } else if (refund.status === 'PENDING') {
          await followRefund(refund.id, refundDeps);
        }
      }
      const after = (await read()) ?? before;
      return {
        kind: 'CHECKED',
        state: depositState(after, facts),
        amountPence: after.amountPence,
        reached,
        refunds: after.refunds.map((refund) => ({ status: refund.status, amountPence: refund.amountPence })),
        before: { status: before.status, refunds: before.refunds.map((refund) => refund.status) },
        after: { status: after.status, refunds: after.refunds.map((refund) => refund.status) },
      };
    },
  };
}

/** What a re-checked deposit is now, for the summary staff read. */
function depositState(attempt: Attempt & { refunds: { status: string }[] }, facts: Facts): DepositCheckState {
  if (attempt.lastError === OPERATIONS_MESSAGES.PAYMENT_LATE_CAPTURE_REFUNDED) return 'LATE_CAPTURE';
  if (facts.mismatch) return 'MISMATCH';
  const booking = attempt.appointment?.status;
  switch (attempt.status) {
    case 'AUTHORIZED':
      if (facts.squareTaken) return 'TAKEN_NOT_CONFIRMED';
      return booking === 'PENDING' ? 'HELD' : 'RELEASE_PENDING';
    case 'CAPTURING':
      return 'IN_PROGRESS';
    case 'CAPTURED':
      if (booking === 'PENDING') return 'TAKEN_NOT_CONFIRMED';
      // Cancelled with neither a refund nor a keep recorded: nobody decided
      // to keep it (a keep is recorded KEPT), so staff are told to look.
      if (booking === 'CANCELLED' && attempt.refunds.length === 0) return 'TAKEN_ON_CANCELLED';
      return 'PAID';
    case 'KEPT':
      // Staff kept it when they cancelled (Admin → Schedule's choice).
      return 'KEPT';
    case 'VOIDED':
    case 'EXPIRED':
    case 'FAILED':
      if (facts.squareTaken) return 'TAKEN_NOT_CONFIRMED';
      return booking === 'PENDING' ? 'HOLD_ENDED' : 'RELEASED';
    default:
      // CAPTURE_UNKNOWN, UNKNOWN, INITIATED.
      return 'UNCONFIRMED';
  }
}

// --- This deployment's wiring ----------------------------------------------------

/** Reconciliation with this deployment's database and guarded Square access. */
async function wired(): Promise<ReturnType<typeof createPaymentReconciliation> | null> {
  // Read per call, never at module load. Null: switched off, incomplete, or
  // the wrong Square environment for this deployment (sandbox credentials in a
  // production build, production credentials anywhere else) — nothing can be asked.
  const config = usableSquareConfig();
  if (!config) return null;
  const { default: prisma } = await import('@/app/lib/prisma');
  return createPaymentReconciliation({ db: prisma, config, gatewayFor: depositGatewayFor });
}

/** The daily run, from /api/cron/housekeeping. Without a usable Square configuration it touches nothing. */
export async function reconcilePayments(): Promise<ReconciliationSummary> {
  const reconciliation = await wired();
  if (!reconciliation) return { skipped: true, checked: 0, lateCaptureRefunds: 0, unresolved: 0, failed: 0, outOfTime: false };
  return reconciliation.reconcileAll();
}

/** The webhook's follow-up for one open notification (app/api/webhooks/square/route.ts). */
export async function reconcileSquareEvent(eventId: string): Promise<boolean> {
  const reconciliation = await wired();
  return reconciliation ? reconciliation.reconcileEventById(eventId) : false;
}

/** "Re-check payment" for one booking (actions/admin-payments.ts). */
export async function recheckAppointmentDeposit(appointmentId: string): Promise<DepositRecheck> {
  const reconciliation = await wired();
  if (reconciliation) return reconciliation.recheckAppointment(appointmentId);
  // Switched off here: say whether there is anything to check at all.
  const { default: prisma } = await import('@/app/lib/prisma');
  const attempt = await prisma.paymentAttempt.findUnique({ where: { appointmentId }, select: { status: true } });
  return attempt ? { kind: 'UNAVAILABLE', status: attempt.status } : { kind: 'NONE' };
}

export type { PaymentRefundStatus };
