import type { Prisma } from '@prisma/client';
import { calculateDepositPence } from './deposit-policy';
import type { Pence } from './pricing/money';
import type { PriceQuote } from './pricing/quote';
import { quoteForNewBooking, type QuotableServiceRow } from './pricing/quote-service';

// The deposit a customer's online booking request takes
// (docs/superpowers/specs/2026-10-13-square-deposits-design.md): a share of the
// SERVER quote, never an amount the browser sends, under the salon policy in
// Admin → Settings unless the service has its own override. Staff-entered
// bookings never take a deposit, and a deposit of 0 is the existing
// no-payment flow.

/** The salon policy, as stored on the SiteSettings row. */
export type DepositSettings = {
  depositsEnabled: boolean;
  /** Whole percent of the quoted price, 0–100. */
  depositPercent: number;
  /** Services quoted below this take no percentage deposit (a fixed override still applies). */
  depositMinimumServicePence: Pence;
};

/** What a deposit was worked out from; kept with the payment attempt (policyJson). */
export type DepositPolicy = {
  enabled: boolean;
  percent: number;
  minimumServicePence: Pence;
  /** The service's override: null = salon policy, 0 = never, N = fixed N pence (capped at the price). */
  overridePence: Pence | null;
};

export type DepositQuote = {
  depositPence: Pence;
  /** Paid in the salon: the quoted price less the deposit. */
  remainderPence: Pence;
  policy: DepositPolicy;
};

/** A settings row that was never saved has the column defaults: deposits off. */
export const DEPOSITS_OFF: DepositSettings = { depositsEnabled: false, depositPercent: 0, depositMinimumServicePence: 0 };

/**
 * Pure. calculateDepositPence decides: off or a free service ⇒ 0; an override
 * wins (capped at the price, 0 = none); below the minimum ⇒ 0; otherwise the
 * percentage, half a penny rounded up. An impossible policy (negative or
 * fractional pence, a percentage outside 0–100) throws a RangeError instead of
 * guessing an amount, so callers refuse the booking.
 */
export function depositForQuote(input: {
  quoteAmountPence: Pence;
  settings: DepositSettings;
  overridePence: Pence | null;
}): DepositQuote {
  const policy: DepositPolicy = {
    enabled: input.settings.depositsEnabled,
    percent: input.settings.depositPercent,
    minimumServicePence: input.settings.depositMinimumServicePence,
    overridePence: input.overridePence,
  };
  const depositPence = calculateDepositPence({
    enabled: policy.enabled,
    servicePricePence: input.quoteAmountPence,
    depositPercent: policy.percent,
    minimumServicePence: policy.minimumServicePence,
    overridePence: policy.overridePence,
  });
  return { depositPence, remainderPence: input.quoteAmountPence - depositPence, policy };
}

const depositSettingsSelect = {
  depositsEnabled: true,
  depositPercent: true,
  depositMinimumServicePence: true,
} satisfies Prisma.SiteSettingsSelect;

/**
 * The policy as it is now, from the row itself. Deliberately not
 * getSiteSettings(): that is a Data Cache entry kept for up to a day for page
 * rendering, and a stale page is harmless where a stale charge is not.
 */
export async function readDepositSettings(db: Pick<Prisma.TransactionClient, 'siteSettings'>): Promise<DepositSettings> {
  const row = await db.siteSettings.findUnique({ where: { id: 'singleton' }, select: depositSettingsSelect });
  return row ?? DEPOSITS_OFF;
}

/**
 * Price and deposit for a customer's new booking request, from current data.
 * The quote is quoteForNewBooking's, so unknown, retired, non-public and
 * inconsistently priced services are refused with a BookingError before the
 * policy is read. The reads run one after another, so this also works on an
 * interactive transaction client.
 */
export async function quoteDepositForNewBooking(
  db: Pick<Prisma.TransactionClient, 'service' | 'siteSettings'>,
  serviceId: string,
): Promise<{ service: QuotableServiceRow; quote: PriceQuote; deposit: DepositQuote }> {
  const { service, quote } = await quoteForNewBooking(db, serviceId, 'CUSTOMER');
  const settings = await readDepositSettings(db);
  const deposit = depositForQuote({
    quoteAmountPence: quote.amountPence,
    settings,
    overridePence: service.depositOverridePence ?? null,
  });
  return { service, quote, deposit };
}
