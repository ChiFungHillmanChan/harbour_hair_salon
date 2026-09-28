/**
 * Pricing policy for the Treatwell-aligned price list (owner decisions of
 * 2026-09-28). Pure module — shared by server pricing, client displays and
 * tests. Changing a value here is a business decision, not a refactor; the
 * tests in policy.test.ts pin each one.
 */

/**
 * Site-wide offers and discount codes do not apply to any new quote or booking
 * while this is true — not to standard prices, not to NHS prices, not from the
 * admin board, not from an old browser tab that still sends a code. Existing
 * Offer/DiscountCode records and their admin screens are kept untouched, codes
 * are never counted as used, and bookings that already used one keep their
 * recorded amount.
 *
 * Deliberately a constant, not a settings toggle: turning discounts back on
 * needs rules for how they combine with NHS prices, which do not exist yet.
 */
export const DISCOUNTS_PAUSED = true as const;

export const PRICE_TYPES = ['STANDARD', 'NHS'] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

export const HAIR_LENGTHS = ['SHORT', 'MEDIUM', 'LONG', 'EXTRA_LONG'] as const;
export type HairLength = (typeof HAIR_LENGTHS)[number];

/**
 * How the price is labelled for tax. The owner's instruction is that the new
 * Treatwell list is shown as "VAT excluded" with the listed amount unchanged —
 * no 20% added, nothing back-calculated. UNSPECIFIED is every row the new list
 * does not cover; it makes no claim either way.
 */
export const VAT_DISPLAYS = ['EXCLUDED', 'UNSPECIFIED'] as const;
export type VatDisplay = (typeof VAT_DISPLAYS)[number];

/**
 * LISTED: the platform's listed amount. SUBJECT_TO_CONSULTATION: a listed
 * amount whose platform fine print says it may change after consultation —
 * never presented as the final amount payable.
 */
export const PRICE_NATURES = ['LISTED', 'SUBJECT_TO_CONSULTATION'] as const;
export type PriceNature = (typeof PRICE_NATURES)[number];

const oneOf = <T extends string>(values: readonly T[]) => (value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

export const isPriceType = oneOf(PRICE_TYPES);
export const isHairLength = oneOf(HAIR_LENGTHS);
export const isVatDisplay = oneOf(VAT_DISPLAYS);
export const isPriceNature = oneOf(PRICE_NATURES);

/** Display order for lengths inside one offering. */
export const HAIR_LENGTH_ORDER: Record<HairLength, number> = { SHORT: 0, MEDIUM: 1, LONG: 2, EXTRA_LONG: 3 };
