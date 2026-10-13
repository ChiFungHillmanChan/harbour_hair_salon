import type { Prisma } from '@prisma/client';

// Pure and client-safe: My Bookings and the admin board describe a booking's
// card deposit (services/deposit-lifecycle.ts) the same way, from the
// attempt's status and its refunds. Only these facts reach the browser —
// never Square ids or the attempt itself.

/**
 * HELD: on the card, not taken. PROCESSING: being taken (or an unanswered
 * capture). PAID: taken. REFUND_PENDING / REFUNDED / REFUND_FAILED: a taken
 * deposit on its way back, back, or stuck. RELEASED: the hold was released or
 * ran out — nothing taken. KEPT: taken, the booking cancelled, and staff
 * chose to keep it (as the booking terms allow) — the attempt says so (KEPT).
 */
export type DepositState = 'HELD' | 'PROCESSING' | 'PAID' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED' | 'RELEASED' | 'KEPT';

/**
 * `refundToSettle` (admin board only, adminDepositView): a refund Square has
 * not confirmed that staff may mark settled outside the website — our own row
 * id and its amount, never a Square id. My Bookings never carries it.
 */
export type DepositView = { state: DepositState; amountPence: number; refundToSettle?: { id: string; amountPence: number } };

/**
 * Refund states staff may mark settled outside the website (refunded in the
 * Square Dashboard or in cash): never sent (REQUESTED), being sent — only once
 * its sender has gone quiet, checked on the server — (SUBMITTING), sent
 * without a usable answer (UNKNOWN), or past the automatic retries
 * (UNRESOLVED). Square has not answered any of them. The server applies the
 * same list (payment-refunds.ts settleRefundOutsideWebsite).
 */
export const SETTLEABLE_REFUND_STATUSES: readonly string[] = ['REQUESTED', 'SUBMITTING', 'UNKNOWN', 'UNRESOLVED'];

/** Refunds that are back with the customer: through Square, or settled outside the website by staff. */
const REFUND_STATUSES_RETURNED = ['COMPLETED', 'SETTLED_EXTERNALLY'];

/** What a page selects to describe a booking's deposit. */
export const depositViewSelect = {
  status: true,
  amountPence: true,
  refunds: { select: { status: true, amountPence: true } },
} satisfies Prisma.PaymentAttemptSelect;

/** The admin board's selection: the same, plus our own refund ids (adminDepositView). */
export const adminDepositViewSelect = {
  status: true,
  amountPence: true,
  refunds: { select: { id: true, status: true, amountPence: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.PaymentAttemptSelect;

type DepositFacts = { status: string; amountPence: number; refunds?: { status: string; amountPence: number }[] };

/** A booking's deposit as the pages show it, or null when it has none worth showing. */
export function depositView(attempt: DepositFacts | null | undefined): DepositView | null {
  if (!attempt || !Number.isSafeInteger(attempt.amountPence) || attempt.amountPence <= 0) return null;
  const amountPence = attempt.amountPence;
  switch (attempt.status) {
    case 'AUTHORIZED':
      return { state: 'HELD', amountPence };
    case 'CAPTURING':
    case 'CAPTURE_UNKNOWN':
      return { state: 'PROCESSING', amountPence };
    case 'CAPTURED': {
      const refunds = attempt.refunds ?? [];
      // Refunds that have returned money or still may (payment-refunds.ts).
      const live = refunds.filter((refund) => refund.status !== 'FAILED' && refund.status !== 'REJECTED');
      if (live.length > 0) {
        const total = live.reduce((sum, refund) => sum + refund.amountPence, 0);
        return { state: live.every((refund) => REFUND_STATUSES_RETURNED.includes(refund.status)) ? 'REFUNDED' : 'REFUND_PENDING', amountPence: total };
      }
      if (refunds.length > 0) return { state: 'REFUND_FAILED', amountPence };
      // Taken. On a cancelled booking with neither a refund nor a keep
      // recorded, nobody decided to keep it: still "paid" (Operations flags it).
      return { state: 'PAID', amountPence };
    }
    case 'KEPT':
      return { state: 'KEPT', amountPence };
    case 'VOIDED':
    case 'EXPIRED':
      return { state: 'RELEASED', amountPence };
    default:
      // FAILED, UNKNOWN, INITIATED: nothing was held for this booking.
      return null;
  }
}

/**
 * The admin board's view (booking dialog): `depositView`, plus the refund
 * staff may mark settled outside the website, when there is one (at most one:
 * every refund is of the whole remainder).
 */
export function adminDepositView(
  attempt: { status: string; amountPence: number; refunds?: { id: string; status: string; amountPence: number }[] } | null | undefined,
): DepositView | null {
  const view = depositView(attempt);
  if (!view || !attempt) return view;
  const unsettled = (attempt.refunds ?? []).find((refund) => SETTLEABLE_REFUND_STATUSES.includes(refund.status));
  return unsettled ? { ...view, refundToSettle: { id: unsettled.id, amountPence: unsettled.amountPence } } : view;
}
