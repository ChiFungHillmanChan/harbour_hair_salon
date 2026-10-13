import 'server-only';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { SquareConfig } from '@/app/lib/square-config';
import { OPERATIONS_MESSAGES } from './operations-messages';
import { isCaptureStale } from './payment-attempts';
import { isRefundProgress, REFUND_STATUSES_MATCHABLE } from './payment-refunds';

// Square's notifications about this site's card deposits
// (docs/superpowers/specs/2026-10-13-square-deposits-design.md, "Webhook";
// route: app/api/webhooks/square/route.ts, which has already checked the
// signature). A notification only ever moves PAYMENT rows forward — never a
// booking — and only where Square's word is final:
//   - a payment COMPLETED, CANCELED or FAILED stays that way, so a capture
//     nobody saw finish becomes CAPTURED, and a hold Square let go becomes
//     EXPIRED (its request still open) or VOIDED, whatever order they come in;
//   - APPROVED / PENDING may be older than what this site already knows, so
//     they never change a status — they only fill in Square's payment id for
//     a submission that never heard back;
//   - a capture an approval is still making (fresh CAPTURING) belongs to that
//     approval and is left alone (payment-attempts.ts CAPTURE_STALE_MS).
// When a notification says Square HOLDS money no booking wants (an
// authorization that landed after the site gave up on it, a hold whose
// release failed) or has TAKEN money this site believed only held or
// released, the event is kept open (`processedAt` null) and the route asks
// Square afresh once it has answered (payment-reconciliation.ts
// reconcileSquareEvent): money is never moved on a notification's word alone.
// If that follow-up does not finish, the daily reconciliation picks the event up.
// Refunds move REQUESTED / SUBMITTING / UNKNOWN / UNRESOLVED → PENDING →
// COMPLETED | FAILED | REJECTED, never back (SETTLED_EXTERNALLY is final). Every write is conditional on the row as it was read, so a
// notification applied twice, or racing the action that caused it, changes
// nothing the second time. Only rows of THIS deployment's Square environment
// and location are touched: preview deployments run on a copy of the
// production database.

/** Square's events are a few kilobytes; anything larger is not one of them. */
export const SQUARE_WEBHOOK_MAX_BYTES = 64 * 1024;

/** The event types acted on. Everything else is acknowledged without touching the database. */
export const SQUARE_WEBHOOK_TYPES = ['payment.created', 'payment.updated', 'refund.created', 'refund.updated'] as const;
export type SquareWebhookType = (typeof SQUARE_WEBHOOK_TYPES)[number];

/**
 * A card submission, or a hold not yet tied to its booking, this young may
 * still be in the middle of its own request (every Square call times out
 * after 10 seconds): nothing releases it from under that request.
 */
export const SUBMISSION_IN_FLIGHT_MS = 15 * 60_000;

/** This site's payments carry the attempt id as `reference_id` (square-gateway.ts: at most 40 of [A-Za-z0-9_-]). */
const REFERENCE_ID = /^[A-Za-z0-9_-]{1,40}$/;

const text = (max: number) => z.string().min(1).max(max);
const envelopeSchema = z.object({
  event_id: text(255),
  type: text(100),
  data: z.object({ id: text(255).optional(), object: z.record(z.string(), z.unknown()).optional() }).loose().optional(),
}).loose();
const moneySchema = z.object({ amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), currency: text(3) }).loose();
// Statuses stay plain strings: one Square adds later is acknowledged and ignored, not refused.
const paymentSchema = z.object({
  id: text(192), status: text(40), amount_money: moneySchema, location_id: text(192), reference_id: z.string().max(255).optional(),
}).loose();
const refundSchema = z.object({
  id: text(255), status: text(40), amount_money: moneySchema, location_id: text(192), payment_id: text(192),
}).loose();

export type SquarePaymentNotice = z.infer<typeof paymentSchema>;
export type SquareRefundNotice = z.infer<typeof refundSchema>;

/**
 * A verified event of a type this site acts on. `unreadable`: its object did
 * not parse (kept as unmatched) — `locationId` is whatever location it still
 * names (null: none readable), so another location's is dropped before the
 * database like a readable one.
 */
export type SquareWebhookEvent =
  | { kind: 'payment'; eventId: string; type: SquareWebhookType; objectId: string; payment: SquarePaymentNotice }
  | { kind: 'refund'; eventId: string; type: SquareWebhookType; objectId: string; refund: SquareRefundNotice }
  | { kind: 'unreadable'; eventId: string; type: SquareWebhookType; objectId: string | null; locationId: string | null };

/**
 * The event in a signature-checked body. `null`: not a Square event at all
 * (not JSON, or no event id or type). `'IGNORED'`: a type this site does not
 * act on.
 */
export function parseSquareWebhookEvent(body: string): SquareWebhookEvent | 'IGNORED' | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return null;
  const { event_id: eventId, type, data } = envelope.data;
  if (!(SQUARE_WEBHOOK_TYPES as readonly string[]).includes(type)) return 'IGNORED';
  const handled = type as SquareWebhookType;
  const object = data?.object ?? {};
  const inner = handled.startsWith('payment.') ? object.payment : object.refund;
  if (handled.startsWith('payment.')) {
    const payment = paymentSchema.safeParse(inner);
    if (payment.success) return { kind: 'payment', eventId, type: handled, objectId: payment.data.id, payment: payment.data };
  } else {
    const refund = refundSchema.safeParse(inner);
    if (refund.success) return { kind: 'refund', eventId, type: handled, objectId: refund.data.id, refund: refund.data };
  }
  // Not the shape expected; its location, if it names one, still decides
  // whether it can be this site's at all (isForeignSquareEvent).
  const located = inner !== null && typeof inner === 'object' ? (inner as Record<string, unknown>).location_id : undefined;
  return { kind: 'unreadable', eventId, type: handled, objectId: data?.id ?? null, locationId: typeof located === 'string' ? located : null };
}

/**
 * Provably not about one of this site's deposits, decided from the event
 * alone, BEFORE any database access: another location's money — a payment, a
 * refund, or an event the schema could not read that still names its location
 * — or a payment without this site's reference (taken in the salon on a
 * Square reader, say). Square notifies every payment and refund on the
 * account, so without this each in-salon card payment would wake the database
 * (CLAUDE.md, "Neon compute budget"). A refund carries no reference: one made
 * at this location is looked up once and, when its payment is none of this
 * site's deposits, settled there and then (recordSquareWebhookEvent, NOT_OURS).
 */
export function isForeignSquareEvent(event: SquareWebhookEvent, config: Pick<SquareConfig, 'locationId'>): boolean {
  if (event.kind === 'payment') {
    return event.payment.location_id !== config.locationId || !REFERENCE_ID.test(event.payment.reference_id ?? '');
  }
  if (event.kind === 'refund') return event.refund.location_id !== config.locationId;
  return event.locationId !== null && event.locationId !== config.locationId;
}

type WebhookDb = Pick<Prisma.TransactionClient, 'paymentAttempt' | 'paymentRefund' | 'squareWebhookEvent'>;
type Deployment = Pick<SquareConfig, 'environment' | 'locationId'>;

/**
 * DUPLICATE: applied before; nothing done. MATCHED: about one of this site's
 * payment rows, applied (whatever, if anything, it changed). CHECK: about one
 * of this site's deposits, but Square must be asked afresh before money moves
 * (`processedAt` stays null until that is done). NOT_OURS: a refund of a
 * payment that is none of this site's deposits (an in-salon refund at this
 * location): settled at once — never listed, never re-read. UNMATCHED:
 * recorded with `processedAt` null — Admin → Operations lists it.
 */
export type SquareWebhookOutcome = 'DUPLICATE' | 'MATCHED' | 'CHECK' | 'NOT_OURS' | 'UNMATCHED';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Store the event once (its `event_id` is the key: Square delivers at least
 * once, retries and reorders) and apply it. A second delivery of an event
 * already applied does nothing; one stored but not finished — unmatched,
 * waiting for a fresh check, or a first delivery that failed half way — is
 * applied again, which is safe because every write is conditional. Throws on
 * a database failure (the route answers 500, so Square delivers it again).
 */
export async function recordSquareWebhookEvent(db: WebhookDb, config: Deployment, event: SquareWebhookEvent, now: Date): Promise<SquareWebhookOutcome> {
  try {
    await db.squareWebhookEvent.create({ data: { eventId: event.eventId, type: event.type, objectId: event.objectId } });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const seen = await db.squareWebhookEvent.findUnique({ where: { eventId: event.eventId }, select: { processedAt: true } });
    if (seen?.processedAt) return 'DUPLICATE';
  }
  const outcome = event.kind === 'payment' ? await applyPaymentNotice(db, config, event.payment, now)
    : event.kind === 'refund' ? await applyRefundNotice(db, config, event.refund)
    : 'UNMATCHED';
  if (outcome === 'MATCHED' || outcome === 'NOT_OURS') await markSquareEventProcessed(db, event.eventId, now);
  return outcome;
}

/** The event is settled: nothing more is owed for it. */
export async function markSquareEventProcessed(db: Pick<Prisma.TransactionClient, 'squareWebhookEvent'>, eventId: string, now: Date): Promise<void> {
  await db.squareWebhookEvent.updateMany({ where: { eventId, processedAt: null }, data: { processedAt: now } });
}

export const noticeAttemptSelect = {
  id: true, status: true, amountPence: true, squarePaymentId: true, environment: true, locationId: true, lastError: true,
  createdAt: true, updatedAt: true, appointmentId: true, appointment: { select: { status: true } },
} satisfies Prisma.PaymentAttemptSelect;
export type NoticeAttempt = Prisma.PaymentAttemptGetPayload<{ select: typeof noticeAttemptSelect }>;

/** Taken in this deployment's Square environment and location (preview databases hold production rows). */
export function inThisDeployment(attempt: { environment: string; locationId: string }, config: Deployment): boolean {
  return attempt.environment === config.environment && attempt.locationId === config.locationId;
}

/**
 * Whether Square holding this deposit is money no booking wants held: an
 * authorization the site gave up on (UNKNOWN), one already let go (VOIDED,
 * FAILED, EXPIRED), a submission that died (INITIATED, no longer in flight),
 * or a hold whose request is closed, or was never booked. A hold its PENDING
 * request still needs, or anything being taken or taken, is not.
 */
export function heldWithoutBooking(attempt: Pick<NoticeAttempt, 'status' | 'appointmentId' | 'appointment' | 'createdAt'>, now: Date): boolean {
  const inFlight = attempt.createdAt.getTime() > now.getTime() - SUBMISSION_IN_FLIGHT_MS;
  switch (attempt.status) {
    case 'UNKNOWN':
    case 'VOIDED':
    case 'FAILED':
    case 'EXPIRED':
      return true;
    case 'INITIATED':
      return !inFlight;
    case 'AUTHORIZED':
      // Not tied to a booking yet: its own submission may be linking it right now.
      if (attempt.appointmentId === null) return !inFlight;
      return attempt.appointment?.status !== 'PENDING';
    default:
      return false;
  }
}

async function applyPaymentNotice(db: WebhookDb, config: Deployment, payment: SquarePaymentNotice, now: Date): Promise<SquareWebhookOutcome> {
  const attempt = await db.paymentAttempt.findUnique({ where: { squarePaymentId: payment.id }, select: noticeAttemptSelect })
    ?? (payment.reference_id ? await db.paymentAttempt.findUnique({ where: { id: payment.reference_id }, select: noticeAttemptSelect }) : null);
  if (!attempt || !inThisDeployment(attempt, config)) return 'UNMATCHED';
  // The same deposit: its reference (the attempt id), amount, currency,
  // location — and Square id, once known.
  if (
    payment.reference_id !== attempt.id || payment.amount_money.amount !== attempt.amountPence || payment.amount_money.currency !== 'GBP'
    || payment.location_id !== attempt.locationId || (attempt.squarePaymentId !== null && attempt.squarePaymentId !== payment.id)
  ) return 'UNMATCHED';
  const change = paymentNoticeChange(attempt, payment, now);
  if (change) await db.paymentAttempt.updateMany(change);
  return noticeNeedsCheck(attempt, payment.status, now) ? 'CHECK' : 'MATCHED';
}

/**
 * Square says it holds (APPROVED) a deposit no booking wants held, or has
 * taken (COMPLETED) one this site believed only held or let go: ask Square
 * afresh and act on that (payment-reconciliation.ts), never on the notice.
 */
export function noticeNeedsCheck(attempt: NoticeAttempt, status: string, now: Date): boolean {
  if (status === 'APPROVED') return heldWithoutBooking(attempt, now);
  if (status === 'COMPLETED') {
    return ['AUTHORIZED', 'UNKNOWN', 'VOIDED', 'FAILED', 'EXPIRED'].includes(attempt.status)
      || (attempt.status === 'INITIATED' && heldWithoutBooking(attempt, now));
  }
  return false;
}

/**
 * The conditional write a payment notification makes to its attempt, or null.
 * Pure: see the rules at the top of this file.
 */
export function paymentNoticeChange(attempt: NoticeAttempt, payment: Pick<SquarePaymentNotice, 'id' | 'status'>, now: Date): Prisma.PaymentAttemptUpdateManyArgs | null {
  // Conditional on exactly the row that was read: an approval claiming it,
  // or a release recording it, in between wins.
  const where = { id: attempt.id, status: attempt.status, updatedAt: attempt.updatedAt };
  const learnId = attempt.squarePaymentId === null ? { squarePaymentId: payment.id } : {};
  // A capture nobody saw finish: unanswered, or claimed so long ago its approval is gone.
  const unfinishedCapture = attempt.status === 'CAPTURE_UNKNOWN' || isCaptureStale(attempt, now);
  const bookingOpen = attempt.appointment?.status === 'PENDING' || attempt.appointment?.status === 'CONFIRMED';
  switch (payment.status) {
    case 'APPROVED':
    case 'PENDING':
      if (attempt.squarePaymentId === null && (attempt.status === 'INITIATED' || attempt.status === 'UNKNOWN')) {
        return { where: { ...where, squarePaymentId: null }, data: learnId };
      }
      return null;
    case 'COMPLETED':
      if (!unfinishedCapture) return null;
      return {
        where,
        data: {
          status: 'CAPTURED', capturedAt: now, ...learnId,
          // Never confirms anything: a request is confirmed only by staff.
          lastError: attempt.appointment?.status === 'CONFIRMED' ? null : OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED,
        },
      };
    case 'CANCELED':
    case 'FAILED':
      if (attempt.status === 'UNKNOWN') {
        // An authorization nobody heard back about is now settled: declined, or let go.
        return {
          where,
          data: payment.status === 'FAILED'
            ? { status: 'FAILED', lastError: OPERATIONS_MESSAGES.PAYMENT_DECLINED, ...learnId }
            : { status: 'VOIDED', voidedAt: now, lastError: OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED, ...learnId },
        };
      }
      if (attempt.status === 'VOIDED' && attempt.lastError === OPERATIONS_MESSAGES.PAYMENT_RELEASED_UNCONFIRMED) {
        // Cancelled by its key without proof anything was there: now Square
        // confirms it, so reconciliation stops asking (payment-reconciliation.ts).
        return { where, data: { lastError: OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED, ...learnId } };
      }
      if (attempt.status === 'AUTHORIZED') {
        // A request still open lost its hold (it ran out, or was released in
        // Square): it can no longer be confirmed — the lapse step closes it.
        if (bookingOpen) return { where, data: { status: 'EXPIRED', lastError: OPERATIONS_MESSAGES.PAYMENT_HOLD_CANCELLED } };
        // Closed, or never booked: the release this site wanted has happened.
        return {
          where,
          data: { status: 'VOIDED', voidedAt: now, lastError: attempt.appointmentId === null ? OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED : null },
        };
      }
      if (unfinishedCapture) return { where, data: { status: 'EXPIRED', lastError: OPERATIONS_MESSAGES.PAYMENT_HOLD_CANCELLED } };
      // INITIATED (its submission is recording the answer), a capture in
      // progress, or already final.
      return null;
    default:
      return null;
  }
}

const noticeRefundSelect = {
  id: true, status: true, amountPence: true, squareRefundId: true,
  attempt: { select: { squarePaymentId: true, environment: true, locationId: true } },
} satisfies Prisma.PaymentRefundSelect;

async function applyRefundNotice(db: WebhookDb, config: Deployment, refund: SquareRefundNotice): Promise<SquareWebhookOutcome> {
  let row = await db.paymentRefund.findUnique({ where: { squareRefundId: refund.id }, select: noticeRefundSelect });
  if (!row) {
    // A refund this site asked for but has not heard back about yet — even
    // one whose sender has not recorded Square's answer (SUBMITTING), or one
    // the daily run stopped retrying (UNRESOLVED: Square's word still counts):
    // the one such refund of that payment for that amount. Anything ambiguous
    // stays unmatched (reconciliation asks again with the row's own key), and
    // so does a refund staff settled outside the website (SETTLED_EXTERNALLY):
    // Square refunding it as well is for them to see.
    const attempt = await db.paymentAttempt.findUnique({
      where: { squarePaymentId: refund.payment_id },
      select: {
        squarePaymentId: true, environment: true, locationId: true,
        refunds: {
          where: { status: { in: [...REFUND_STATUSES_MATCHABLE] }, squareRefundId: null, amountPence: refund.amount_money.amount },
          select: { id: true, status: true, amountPence: true, squareRefundId: true },
          take: 2,
        },
      },
    });
    // Its payment is none of this site's deposits (refunded on the salon's
    // card reader, say): nothing here to settle, nothing for staff to look at.
    if (!attempt) return 'NOT_OURS';
    // One of this site's deposits, but no single refund of ours it can be
    // (made in the Square Dashboard, or ambiguous): listed for staff.
    if (attempt.refunds.length !== 1) return 'UNMATCHED';
    const { refunds, ...owner } = attempt;
    row = { ...refunds[0], attempt: owner };
  }
  if (
    !inThisDeployment(row.attempt, config) || row.attempt.squarePaymentId !== refund.payment_id || refund.location_id !== row.attempt.locationId
    || row.amountPence !== refund.amount_money.amount || refund.amount_money.currency !== 'GBP'
    || (row.squareRefundId !== null && row.squareRefundId !== refund.id)
  ) return 'UNMATCHED';
  if (!isRefundProgress(row.status, refund.status)) return 'MATCHED';
  try {
    await db.paymentRefund.updateMany({
      where: { id: row.id, status: row.status, squareRefundId: row.squareRefundId },
      data: { status: refund.status, squareRefundId: refund.id },
    });
  } catch (error) {
    // Another row already carries this Square refund id: not this one's.
    if (isUniqueViolation(error)) return 'UNMATCHED';
    throw error;
  }
  return 'MATCHED';
}
