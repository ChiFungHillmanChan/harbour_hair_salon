import { toPence, type Pence } from './money';
import { DISCOUNTS_PAUSED, isHairLength, isPriceNature, isPriceType, isVatDisplay, type HairLength, type PriceNature, type PriceType, type VatDisplay } from './policy';

/**
 * The price a NEW booking commits to, decided on the server. Language never
 * enters it: the same service/option gives the same quote on /book and
 * /zh-hk/book. Stored verbatim on the appointment (quoteJson) so the amount,
 * its NHS/standard type, VAT wording and composition can be shown later
 * exactly as agreed — even after the price list changes.
 */
export type PriceQuote = {
  schema: 1;
  serviceId: string;
  offeringId: string | null;
  hairLength: HairLength | null;
  priceType: PriceType;
  currency: 'GBP';
  amountPence: Pence;
  /** How amountPence is composed. Sums to amountPence exactly. */
  breakdown: QuoteLine[];
  vatDisplay: VatDisplay;
  priceNature: PriceNature;
  priceVersion: number;
  durationMinutes: number;
  durationSource: 'SERVICE' | 'UNCONFIRMED';
  /** Always false while DISCOUNTS_PAUSED: no offer or code was applied. */
  discountsApplied: false;
  priceSource: string | null;
};

export type QuoteLine =
  | { kind: 'LISTED'; amountPence: Pence }
  | { kind: 'BASE_OPTION'; serviceId: string; amountPence: Pence }
  | { kind: 'EXTRA_LONG_SURCHARGE'; amountPence: Pence };

/** The Service columns pricing reads. Decimal-like values are accepted as-is. */
export type QuotableService = {
  id: string;
  price: { toString(): string } | number;
  duration: number;
  offeringId: string | null;
  hairLength: string | null;
  priceType: string;
  priceVersion: number;
  vatDisplay: string;
  priceNature: string;
  durationConfirmed: boolean;
  surchargeBaseServiceId: string | null;
  surchargeAmount: { toString(): string } | number | null;
  priceSource: string | null;
};

export type QuoteBase = Pick<QuotableService, 'id' | 'price'>;

export class QuoteIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteIntegrityError';
  }
}

/**
 * Build the quote for one service row. A composite option (extra-long colour)
 * must be passed its base option; its stored price must equal base + surcharge
 * or the quote is refused — the surcharge is never added on top of a price
 * that already includes it.
 */
export function buildQuote(service: QuotableService, base?: QuoteBase | null): PriceQuote {
  const amountPence = toPence(service.price);
  if (amountPence < 0) throw new QuoteIntegrityError(`Service ${service.id} has a negative price`);
  let breakdown: QuoteLine[] = [{ kind: 'LISTED', amountPence }];
  if (service.surchargeBaseServiceId) {
    if (!base || base.id !== service.surchargeBaseServiceId || service.surchargeAmount === null) {
      throw new QuoteIntegrityError(`Service ${service.id} is a composite price but its base option is missing`);
    }
    const basePence = toPence(base.price);
    const surchargePence = toPence(service.surchargeAmount);
    if (basePence + surchargePence !== amountPence) {
      throw new QuoteIntegrityError(`Service ${service.id} price ${amountPence}p is not base ${basePence}p + surcharge ${surchargePence}p`);
    }
    breakdown = [
      { kind: 'BASE_OPTION', serviceId: base.id, amountPence: basePence },
      { kind: 'EXTRA_LONG_SURCHARGE', amountPence: surchargePence },
    ];
  }
  return {
    schema: 1,
    serviceId: service.id,
    offeringId: service.offeringId,
    hairLength: isHairLength(service.hairLength) ? service.hairLength : null,
    priceType: isPriceType(service.priceType) ? service.priceType : 'STANDARD',
    currency: 'GBP',
    amountPence,
    breakdown,
    vatDisplay: isVatDisplay(service.vatDisplay) ? service.vatDisplay : 'UNSPECIFIED',
    priceNature: isPriceNature(service.priceNature) ? service.priceNature : 'LISTED',
    priceVersion: service.priceVersion,
    durationMinutes: service.duration,
    durationSource: service.durationConfirmed ? 'SERVICE' : 'UNCONFIRMED',
    discountsApplied: false,
    priceSource: service.priceSource,
  };
}

/** What the client last showed the customer; compared on submit. */
export type QuoteExpectation = { serviceId: string; priceVersion: number; amountPence: Pence };

/** True when the price the customer confirmed is still the price. */
export function quoteMatches(quote: PriceQuote, expected: QuoteExpectation | null | undefined): boolean {
  return Boolean(expected)
    && expected!.serviceId === quote.serviceId
    && expected!.priceVersion === quote.priceVersion
    && expected!.amountPence === quote.amountPence;
}

/** Read a stored quote; anything unrecognised is treated as absent (unknown). */
export function parseQuote(json: string | null | undefined): PriceQuote | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<PriceQuote>;
    if (value?.schema !== 1 || typeof value.amountPence !== 'number' || !isPriceType(value.priceType) || !isVatDisplay(value.vatDisplay)) return null;
    return value as PriceQuote;
  } catch {
    return null;
  }
}

export function serializeQuote(quote: PriceQuote): string {
  return JSON.stringify(quote);
}

// Referenced so the pause is visible at the point every quote is built.
void DISCOUNTS_PAUSED;
