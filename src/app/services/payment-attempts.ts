import 'server-only';
import { Prisma } from '@prisma/client';
import type { SquareConfig } from '@/app/lib/square-config';
import { describeFault } from '@/app/lib/fault';
import type { BookingErrorCode } from './booking-errors';
import type { DepositPolicy } from './deposit-quote';
import { OPERATIONS_MESSAGES } from './operations-messages';
import { SquareGatewayError, type createSquareGateway, type SquarePayment } from './square-gateway';

// One card deposit per booking request
// (docs/superpowers/specs/2026-10-13-square-deposits-design.md). A row is
// written BEFORE Square is asked for anything, so every authorization can be
// found again by its key — after a timeout, a crash or a repeated submission —
// and it is never authorized twice. Square is called outside every database
// transaction: the booking transaction retries, and a retried transaction must
// never repeat a money movement.
//
//   INITIATED → AUTHORIZED → CAPTURING → CAPTURED   (staff confirmed: taken)
//             ↘ FAILED     (declined — HTTP 400/402 only —, refused by this
//                           website's Square setup, or never sent: nothing held)
//             ↘ UNKNOWN    (no answer) → VOIDED once cancelled by its key
//   AUTHORIZED ↘ VOIDED    (released: declined, withdrawn, lapsed, or never booked)
//              ↘ EXPIRED   (the hold ran out before staff confirmed)
//   CAPTURING  → AUTHORIZED (Square refused: nothing taken) | EXPIRED (Square had dropped it)
//              ↘ CAPTURE_UNKNOWN (no answer) → CAPTURING again: the next try reads Square first
//   CAPTURED   → KEPT       (staff cancelled the booking and kept the deposit, as the terms allow)
//
// `lastError` only ever holds one of OPERATIONS_MESSAGES' sentences (Admin →
// Operations translates them), never Square's own text.

/** Every state a PaymentAttempt row can be in (the column is a plain string). */
export type PaymentAttemptStatus =
  | 'INITIATED' | 'AUTHORIZED' | 'CAPTURING' | 'CAPTURED'
  | 'FAILED' | 'UNKNOWN' | 'VOIDED' | 'EXPIRED' | 'CAPTURE_UNKNOWN' | 'KEPT';

type Gateway = Pick<ReturnType<typeof createSquareGateway>, 'authorize' | 'cancel' | 'cancelByIdempotencyKey' | 'getPayment' | 'capture'>;
type AttemptDb = Pick<Prisma.TransactionClient, 'paymentAttempt'>;

/**
 * How long a capture nobody saw finish must be left alone before it is
 * settled from Square's word. CAPTURING: another approval (or a closing) may
 * take the claim over — every Square call times out after 10 seconds and an
 * approval makes at most three once it has claimed the attempt, so a claim
 * this old belongs to an approval that died, or whose confirmation could not
 * be saved. CAPTURE_UNKNOWN: a CompletePayment that timed out may still be on
 * its way; read too early, Square shows APPROVED, a closing releases the hold,
 * and the capture can land afterwards on a closed booking. After this long it
 * has landed or never will. (Confirming again needs no wait: it reads Square
 * first and captures with Square's version token, so it never takes twice.)
 */
export const CAPTURE_STALE_MS = 2 * 60_000;

/** A capture nobody saw finish (CAPTURING or CAPTURE_UNKNOWN), quiet long enough to settle (see CAPTURE_STALE_MS). */
export function isCaptureStale(attempt: { status: string; updatedAt: Date }, now: Date): boolean {
  return (attempt.status === 'CAPTURING' || attempt.status === 'CAPTURE_UNKNOWN')
    && attempt.updatedAt.getTime() <= now.getTime() - CAPTURE_STALE_MS;
}

/** What a capture starts from: a hold nobody has tried to take, or one whose earlier capture went unanswered. */
export type CaptureOrigin = 'AUTHORIZED' | 'CAPTURE_UNKNOWN';

/**
 * What became of a capture (`capture`), or of a capture nobody saw finish (`settle`).
 *  - CAPTURED: Square has taken it (COMPLETED) — just now or earlier.
 *  - AUTHORIZED: nothing was taken and the hold still stands.
 *  - EXPIRED: Square had already dropped the hold (it ran out, or was released).
 *  - REFUSED: Square refused, or its payment did not match: nothing taken.
 *  - UNCONFIRMED: no usable answer; CAPTURE_UNKNOWN until someone asks again.
 *  - UNAVAILABLE: payments are switched off here; nothing was sent.
 *  - BUSY: someone else is finding out right now.
 */
export type CaptureOutcome = 'CAPTURED' | 'AUTHORIZED' | 'EXPIRED' | 'REFUSED' | 'UNCONFIRMED' | 'UNAVAILABLE' | 'BUSY';

/** The attempt fields a capture or a release works from. */
export type HeldAttempt = { id: string; amountPence: number; squarePaymentId: string | null };

/** Why an authorized hold was released, when Operations should be told: one of the catalogued sentences. */
export type ReleaseNote =
  | typeof OPERATIONS_MESSAGES.PAYMENT_RELEASED_NOT_BOOKED
  | typeof OPERATIONS_MESSAGES.PAYMENT_RELEASED_REPEAT
  | typeof OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED;

/**
 * Square's CreatePayment idempotency key for one card submission: the
 * customer's attempt key (a UUID) as 36 characters of [a-z0-9_], inside
 * Square's 45. The same submission always maps to the same key, so a retried
 * request can only ever replay the first authorization, never add a second.
 */
export function depositIdempotencyKey(attemptKey: string): string {
  return `dep_${attemptKey.toLowerCase().replace(/-/g, '')}`;
}

/** What a deposit was taken for: the request fingerprint stored with the attempt. */
export type DepositRequest = {
  serviceId: string;
  /** The stylist the customer chose: an id, or ANY_STYLIST_ID for "Anyone". */
  stylist: string;
  /** The requested start, as an ISO instant. */
  start: string;
};

export function depositRequestJson(request: DepositRequest): string {
  return JSON.stringify({ serviceId: request.serviceId, stylist: request.stylist, start: request.start });
}

/**
 * Shown to the salon in Square next to the payment: what the deposit is for,
 * never who paid it (no name, email or phone). Square allows 500 characters.
 */
export function depositPaymentNote(serviceName: string, salonDate: string, salonTime: string): string {
  return `Booking deposit: ${serviceName.trim() || 'service'} on ${salonDate} at ${salonTime} (salon time)`.slice(0, 500);
}

const attemptSelect = {
  id: true,
  userId: true,
  attemptKey: true,
  idempotencyKey: true,
  appointmentId: true,
  status: true,
  amountPence: true,
  squarePaymentId: true,
  requestJson: true,
  lastError: true,
} satisfies Prisma.PaymentAttemptSelect;

export type DepositAttempt = Prisma.PaymentAttemptGetPayload<{ select: typeof attemptSelect }>;

export type AuthorizeOutcome =
  /** Square holds the deposit; the attempt is AUTHORIZED and carries the payment id. */
  | { outcome: 'AUTHORIZED'; attempt: DepositAttempt & { squarePaymentId: string } }
  /** Square declined the card, or it could not be verified (HTTP 400 / 402): nothing is held (FAILED). */
  | { outcome: 'DECLINED' }
  /** Nothing was sent: payments switched off, or the request never passed this server's own checks (FAILED). */
  | { outcome: 'UNAVAILABLE' }
  /**
   * Square refused the request itself — 401, 403, 404 or any other 4xx but
   * 400/402: this website's access token, permissions or location, never the
   * customer's card. Nothing is held (FAILED, PAYMENT_SETUP_REFUSED); not a
   * decline, so it never uses up a customer's decline budget.
   */
  | { outcome: 'SETUP_REFUSED' }
  /** No usable answer: money may have moved. Cancelled by key when Square allowed it. */
  | { outcome: 'UNCERTAIN' };

/**
 * The only HTTP statuses that mean Square refused the CARD: 402 (declined,
 * CVV / address / 3-D Secure failures) and 400 (a card token that is used,
 * expired or invalid). The gateway deliberately never reads Square's error
 * body, so anything else Square refuses — 401 (access token), 403
 * (permissions), 404 (location), … — can only be the website's own setup.
 */
export const CARD_DECLINE_HTTP_STATUSES: readonly number[] = [400, 402];

/** Whether a gateway error is Square refusing the customer's card (a decline), by its HTTP status alone. */
export function isCardDecline(error: unknown): boolean {
  return error instanceof SquareGatewayError && error.kind === 'provider_error'
    && error.httpStatus !== undefined && CARD_DECLINE_HTTP_STATUSES.includes(error.httpStatus);
}

/**
 * HTTP statuses already reported as a setup refusal by this server instance:
 * a broken credential refuses every customer, so each status is logged once
 * (the attempts themselves, and the daily "needs attention" email, count them).
 */
const reportedSetupRefusals = new Set<number | null>();

function reportSetupRefusal(attemptId: string, httpStatus: number | undefined): void {
  const status = httpStatus ?? null;
  if (reportedSetupRefusals.has(status)) return;
  reportedSetupRefusals.add(status);
  console.error('Square refused a deposit authorization: check the Square access token, permissions and location (logged once per HTTP status)', { attemptId, httpStatus: status });
}

/**
 * What a repeated submission (the same attempt key) is told, from what the
 * first one left behind — never a second authorization, and the same answer
 * the first one got wherever that is known (an unanswered or cancelled-by-key
 * authorization: PAYMENT_UNCERTAIN). `BOOKED`: the appointment exists.
 * Otherwise the customer error to show.
 */
export function replayAnswer(attempt: Pick<DepositAttempt, 'appointmentId' | 'status' | 'lastError'>): 'BOOKED' | BookingErrorCode {
  if (attempt.appointmentId) return 'BOOKED';
  switch (attempt.status as PaymentAttemptStatus) {
    case 'FAILED':
      // Never sent, or refused by this website's own Square setup: not the card.
      return attempt.lastError === OPERATIONS_MESSAGES.PAYMENT_NOT_SENT || attempt.lastError === OPERATIONS_MESSAGES.PAYMENT_SETUP_REFUSED
        ? 'PAYMENT_UNAVAILABLE' : 'CARD_DECLINED';
    case 'VOIDED':
    case 'EXPIRED':
      // Released because the time went before the booking was saved.
      return attempt.lastError === OPERATIONS_MESSAGES.PAYMENT_RELEASED_NOT_BOOKED ? 'SLOT_UNAVAILABLE' : 'PAYMENT_UNCERTAIN';
    case 'AUTHORIZED':
      // Nothing was booked and releasing the hold failed (it lapses by itself);
      // otherwise the first submission is still between Square and the booking.
      return attempt.lastError === OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED ? 'PAYMENT_UNCERTAIN' : 'PAYMENT_PENDING';
    case 'UNKNOWN':
      // Square gave no usable answer and cancelling by key has not gone
      // through yet (reconciliation does it): what the first submission was
      // told. A new card entry starts afresh under a new key.
      return 'PAYMENT_UNCERTAIN';
    default:
      // INITIATED: the first submission is still with Square.
      return 'PAYMENT_PENDING';
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Loggable: the error's name and code, plus a gateway error's kind and HTTP status (never provider text). */
function fault(error: unknown) {
  return error instanceof SquareGatewayError
    ? { ...describeFault(error), kind: error.kind, httpStatus: error.httpStatus }
    : describeFault(error);
}

/**
 * Dependency-injected (database + gateway) so the whole lifecycle is testable
 * without Square. Every status change is conditional on the state it leaves,
 * so a later writer (S4's webhook, reconciliation) is never overwritten.
 */
export function createPaymentAttemptService(dependencies: { db: AttemptDb; gateway: Gateway; now?: () => Date }) {
  const { db, gateway } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  /**
   * Record what Square said. Never throws: the customer's answer follows
   * Square, and a row left behind by a database fault is exactly what
   * reconciliation looks for (an INITIATED, UNKNOWN or orphaned AUTHORIZED attempt).
   */
  async function record(id: string, from: PaymentAttemptStatus, data: Prisma.PaymentAttemptUpdateManyMutationInput): Promise<boolean> {
    try {
      await db.paymentAttempt.updateMany({ where: { id, status: from }, data });
      return true;
    } catch (error) {
      console.error('Recording a deposit attempt failed', { attemptId: id, from, ...describeFault(error) });
      return false;
    }
  }

  /** Best effort: cancel by key after an unknown outcome. Never throws. */
  async function cancelUnconfirmed(attempt: Pick<DepositAttempt, 'id' | 'idempotencyKey'>): Promise<boolean> {
    try {
      // Square answers {} whether or not a payment matched: either way no
      // hold remains for this key.
      await gateway.cancelByIdempotencyKey(attempt.idempotencyKey);
    } catch {
      return false;
    }
    await record(attempt.id, 'UNKNOWN', { status: 'VOIDED', voidedAt: now(), lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED });
    return true;
  }

  return {
    /** The attempt this customer already made with this key, if any. */
    find(userId: string, attemptKey: string): Promise<DepositAttempt | null> {
      return db.paymentAttempt.findUnique({ where: { userId_attemptKey: { userId, attemptKey } }, select: attemptSelect });
    },

    /**
     * The INITIATED row, before any call to Square. Null when this customer's
     * key is already taken — a concurrent copy of the same submission — so the
     * caller replays that one instead of authorizing again.
     */
    async create(input: {
      userId: string;
      attemptKey: string;
      amountPence: number;
      quoteAmountPence: number;
      policy: DepositPolicy;
      request: DepositRequest;
      config: Pick<SquareConfig, 'environment' | 'locationId'>;
    }): Promise<DepositAttempt | null> {
      try {
        return await db.paymentAttempt.create({
          data: {
            userId: input.userId,
            attemptKey: input.attemptKey,
            idempotencyKey: depositIdempotencyKey(input.attemptKey),
            status: 'INITIATED',
            environment: input.config.environment,
            locationId: input.config.locationId,
            amountPence: input.amountPence,
            currency: 'GBP',
            quoteAmountPence: input.quoteAmountPence,
            policyJson: JSON.stringify(input.policy),
            requestJson: depositRequestJson(input.request),
          },
          select: attemptSelect,
        });
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    /**
     * Ask Square to hold the deposit (delayed capture: nothing is taken until
     * staff approve). Outside any transaction, with the attempt's own key and
     * id, so asking again can only return this same authorization.
     */
    async authorize(attempt: DepositAttempt, input: { sourceId: string; note: string }): Promise<AuthorizeOutcome> {
      let payment: Awaited<ReturnType<Gateway['authorize']>>;
      try {
        payment = await gateway.authorize({
          sourceId: input.sourceId,
          amountPence: attempt.amountPence,
          idempotencyKey: attempt.idempotencyKey,
          referenceId: attempt.id,
          note: input.note,
        });
      } catch (error) {
        const kind = error instanceof SquareGatewayError ? error.kind : null;
        if (isCardDecline(error)) {
          // Square refused the card: a decline, a failed 3-D Secure check, a
          // used or malformed token (HTTP 402 / 400).
          await record(attempt.id, 'INITIATED', { status: 'FAILED', lastError: OPERATIONS_MESSAGES.PAYMENT_DECLINED });
          return { outcome: 'DECLINED' };
        }
        if (kind === 'provider_error') {
          // Square refused the request itself (401, 403, 404, …): this
          // website's Square setup. Nothing was created, so nothing is held.
          reportSetupRefusal(attempt.id, (error as SquareGatewayError).httpStatus);
          await record(attempt.id, 'INITIATED', { status: 'FAILED', lastError: OPERATIONS_MESSAGES.PAYMENT_SETUP_REFUSED });
          return { outcome: 'SETUP_REFUSED' };
        }
        if (kind === 'disabled' || kind === 'invalid_input') {
          // Never left this server: switched off, or the request (the card
          // token, say) did not pass the gateway's own checks.
          if (kind === 'invalid_input') console.error('A deposit authorization was not sent: it did not pass the gateway checks', { attemptId: attempt.id });
          await record(attempt.id, 'INITIATED', { status: 'FAILED', lastError: OPERATIONS_MESSAGES.PAYMENT_NOT_SENT });
          return { outcome: 'UNAVAILABLE' };
        }
        // A timeout, a 5xx or an unreadable answer: Square may hold money for
        // this key. Ask it to cancel by the same key; if that fails too the
        // attempt stays UNKNOWN for reconciliation, and Square drops an
        // uncaptured hold when it expires.
        if (!kind) console.error('Deposit authorization failed unexpectedly', { attemptId: attempt.id, ...fault(error) });
        await record(attempt.id, 'INITIATED', { status: 'UNKNOWN', lastError: OPERATIONS_MESSAGES.PAYMENT_OUTCOME_UNKNOWN });
        await cancelUnconfirmed(attempt);
        return { outcome: 'UNCERTAIN' };
      }

      const recorded = await record(attempt.id, 'INITIATED', {
        status: 'AUTHORIZED',
        squarePaymentId: payment.id,
        // authorize() refuses an answer without it.
        delayedUntil: new Date(payment.delayed_until!),
        authorizedAt: now(),
        lastError: null,
      });
      if (!recorded) {
        // Square holds the money but this server cannot say so: release it by
        // key rather than book a deposit nobody can find. If that fails too,
        // the INITIATED row is left for reconciliation.
        try {
          await gateway.cancelByIdempotencyKey(attempt.idempotencyKey);
        } catch {
          // See above.
        }
        return { outcome: 'UNCERTAIN' };
      }
      return { outcome: 'AUTHORIZED', attempt: { ...attempt, status: 'AUTHORIZED', squarePaymentId: payment.id, lastError: null } };
    },

    cancelUnconfirmed,

    /**
     * Release (void) an AUTHORIZED hold: nothing is taken from the card. Used
     * when the booking is not made after authorization, and once a request
     * is declined, withdrawn or lapses (deposit-lifecycle.ts releaseDepositHold,
     * after that change has committed). Never throws: on failure the attempt stays
     * AUTHORIZED, marked for reconciliation, and Square cancels the hold
     * itself when it expires (delay_action CANCEL).
     */
    async release(
      attempt: Pick<DepositAttempt, 'id' | 'amountPence'> & { squarePaymentId: string | null },
      note: ReleaseNote | null = null,
    ): Promise<boolean> {
      if (!attempt.squarePaymentId) return false;
      try {
        await gateway.cancel({ paymentId: attempt.squarePaymentId, amountPence: attempt.amountPence, referenceId: attempt.id });
      } catch (error) {
        console.error('Releasing a deposit hold failed', { attemptId: attempt.id, ...fault(error) });
        await record(attempt.id, 'AUTHORIZED', { lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED });
        return false;
      }
      await record(attempt.id, 'AUTHORIZED', { status: 'VOIDED', voidedAt: now(), lastError: note });
      return true;
    },

    /**
     * Take (capture) the deposit of an attempt the approval has already
     * claimed (CAPTURING, conditionally, in its transaction). Outside every
     * transaction. Always reads the payment first — so a retry after an
     * unanswered capture never captures blindly — and captures with Square's
     * version token, so a payment that changed since that read is never
     * taken. CAPTURED leaves the attempt CAPTURING: the caller records it
     * together with the booking. Everything else is recorded here; never throws.
     */
    async capture(attempt: HeldAttempt, origin: CaptureOrigin): Promise<CaptureOutcome> {
      const paymentId = attempt.squarePaymentId;
      // Back where the approval found it, when nothing was asked of Square
      // that could have moved money.
      const restore = (lastError: string) => record(attempt.id, 'CAPTURING', { status: origin, lastError });
      const stillUnknown = origin === 'CAPTURE_UNKNOWN' ? OPERATIONS_MESSAGES.PAYMENT_CAPTURE_UNKNOWN : null;
      if (!paymentId) {
        await restore(OPERATIONS_MESSAGES.PAYMENT_MISMATCH);
        return 'REFUSED';
      }

      let payment: SquarePayment;
      try {
        payment = await gateway.getPayment(paymentId);
      } catch (error) {
        const kind = kindOf(error);
        if (!kind) console.error('Checking a deposit before capture failed unexpectedly', { attemptId: attempt.id, ...fault(error) });
        await restore(stillUnknown ?? OPERATIONS_MESSAGES.PAYMENT_CHECK_FAILED);
        return kind === 'disabled' ? 'UNAVAILABLE' : kind === 'provider_error' || kind === 'invalid_input' ? 'REFUSED' : 'UNCONFIRMED';
      }
      if (!paymentMatches(payment, attempt)) {
        await restore(OPERATIONS_MESSAGES.PAYMENT_MISMATCH);
        return 'REFUSED';
      }
      switch (payment.status) {
        case 'COMPLETED':
          // Taken already: by an earlier capture whose answer was lost.
          return 'CAPTURED';
        case 'CANCELED':
        case 'FAILED':
          await record(attempt.id, 'CAPTURING', { status: 'EXPIRED', lastError: OPERATIONS_MESSAGES.PAYMENT_HOLD_CANCELLED });
          return 'EXPIRED';
        case 'PENDING':
          await restore(stillUnknown ?? OPERATIONS_MESSAGES.PAYMENT_CHECK_FAILED);
          return 'UNCONFIRMED';
        case 'APPROVED':
          break;
      }
      if (!payment.version_token) {
        await restore(stillUnknown ?? OPERATIONS_MESSAGES.PAYMENT_CAPTURE_REFUSED);
        return 'REFUSED';
      }

      try {
        await gateway.capture({ paymentId, amountPence: attempt.amountPence, referenceId: attempt.id, versionToken: payment.version_token });
        return 'CAPTURED';
      } catch (error) {
        const kind = kindOf(error);
        if (!kind) console.error('Capturing a deposit failed unexpectedly', { attemptId: attempt.id, ...fault(error) });
        if (kind === 'disabled' || kind === 'invalid_input') {
          // Never sent.
          await restore(stillUnknown ?? OPERATIONS_MESSAGES.PAYMENT_CAPTURE_REFUSED);
          return kind === 'disabled' ? 'UNAVAILABLE' : 'REFUSED';
        }
        // Square refused (a 4xx: the hold expired, the version changed, …) or
        // gave no usable answer: what does the payment say now?
        const seen = await observe(paymentId, attempt);
        if (seen?.status === 'COMPLETED') return 'CAPTURED';
        if (seen?.status === 'CANCELED' || seen?.status === 'FAILED') {
          await record(attempt.id, 'CAPTURING', { status: 'EXPIRED', lastError: OPERATIONS_MESSAGES.PAYMENT_HOLD_CANCELLED });
          return 'EXPIRED';
        }
        if (kind === 'provider_error') {
          // Refused, and nothing shows it taken: the hold stands. (Unread, an
          // earlier unanswered capture stays unanswered.)
          await record(attempt.id, 'CAPTURING', seen?.status === 'APPROVED'
            ? { status: 'AUTHORIZED', lastError: OPERATIONS_MESSAGES.PAYMENT_CAPTURE_REFUSED }
            : { status: origin, lastError: stillUnknown ?? OPERATIONS_MESSAGES.PAYMENT_CAPTURE_REFUSED });
          return 'REFUSED';
        }
        // A capture that may yet have happened: the next try reads Square first.
        await record(attempt.id, 'CAPTURING', { status: 'CAPTURE_UNKNOWN', lastError: OPERATIONS_MESSAGES.PAYMENT_CAPTURE_UNKNOWN });
        return 'UNCONFIRMED';
      }
    },

    /**
     * Find out what became of a capture nobody saw finish — CAPTURE_UNKNOWN or
     * CAPTURING, quiet for CAPTURE_STALE_MS (isCaptureStale; BUSY before that:
     * the capture may still land) — before its booking is closed.
     * Claims the attempt first (conditionally), so two people never ask at
     * once. CAPTURED: Square took it (recorded CAPTURED, without a booking
     * change — closing it refunds it, confirming it keeps it). AUTHORIZED: the
     * hold stands. EXPIRED: Square dropped it. Never throws.
     */
    async settle(attempt: HeldAttempt & { status: string; updatedAt: Date }): Promise<CaptureOutcome> {
      if (!isCaptureStale(attempt, now())) return 'BUSY';
      try {
        const claimed = await db.paymentAttempt.updateMany({
          where: { id: attempt.id, status: attempt.status, updatedAt: attempt.updatedAt },
          data: { status: 'CAPTURING', updatedAt: now() },
        });
        if (claimed.count !== 1) return 'BUSY';
      } catch (error) {
        console.error('Claiming a deposit to check it failed', { attemptId: attempt.id, ...describeFault(error) });
        return 'BUSY';
      }
      const unknown = { status: 'CAPTURE_UNKNOWN', lastError: OPERATIONS_MESSAGES.PAYMENT_CAPTURE_UNKNOWN };
      if (!attempt.squarePaymentId) {
        await record(attempt.id, 'CAPTURING', unknown);
        return 'UNCONFIRMED';
      }
      const seen = await observe(attempt.squarePaymentId, attempt);
      switch (seen?.status) {
        case 'COMPLETED':
          await record(attempt.id, 'CAPTURING', { status: 'CAPTURED', capturedAt: now(), lastError: OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED });
          return 'CAPTURED';
        case 'APPROVED':
          await record(attempt.id, 'CAPTURING', {
            status: 'AUTHORIZED', lastError: null,
            ...(seen.delayed_until ? { delayedUntil: new Date(seen.delayed_until) } : {}),
          });
          return 'AUTHORIZED';
        case 'CANCELED':
        case 'FAILED':
          await record(attempt.id, 'CAPTURING', { status: 'EXPIRED', lastError: OPERATIONS_MESSAGES.PAYMENT_HOLD_CANCELLED });
          return 'EXPIRED';
        default:
          await record(attempt.id, 'CAPTURING', unknown);
          return 'UNCONFIRMED';
      }
    },
  };

  /** The payment as Square has it now, or null when it cannot say (or it is not this deposit's). */
  async function observe(paymentId: string, attempt: HeldAttempt): Promise<SquarePayment | null> {
    try {
      const payment = await gateway.getPayment(paymentId);
      return paymentMatches(payment, attempt) ? payment : null;
    } catch {
      return null;
    }
  }
}

/** The payment is this deposit's: same id, amount and reference (the attempt id). */
export function paymentMatches(payment: SquarePayment, attempt: HeldAttempt): boolean {
  return payment.id === attempt.squarePaymentId && payment.amount_money.amount === attempt.amountPence && payment.reference_id === attempt.id;
}

function kindOf(error: unknown): SquareGatewayError['kind'] | null {
  return error instanceof SquareGatewayError ? error.kind : null;
}

export type PaymentAttemptService = ReturnType<typeof createPaymentAttemptService>;
