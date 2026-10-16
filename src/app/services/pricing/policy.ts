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
// BEFORE unpausing:
// - the offer items on /booking-terms and /offers (legal.bookingTerms.offers)
//   must be enforced in code, not just stated: one discount code per booking,
//   never combined with NHS/student prices or another offer, no cash value (it
//   applies to the listed price);
// - the booking wizard's discount-code field must show a one-line summary of
//   those terms linking to /booking-terms (spec 2026-10-16 §5, E2). The wizard
//   has no code field while this is true, so the summary is built with it.

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

/**
 * A consultation-required service's price is a starting point: the stylist
 * confirms the final price at the consultation (owner, 2026-10-16). The rule
 * lives here, not in each service row, so a service switched to "consultation
 * required" reads right everywhere at once.
 */
export function effectivePriceNature(service: { requiresConsultation: boolean; priceNature: string }): PriceNature {
  return service.requiresConsultation ? 'SUBJECT_TO_CONSULTATION' : (service.priceNature as PriceNature);
}

export const isPriceType = oneOf(PRICE_TYPES);
export const isHairLength = oneOf(HAIR_LENGTHS);
export const isVatDisplay = oneOf(VAT_DISPLAYS);
export const isPriceNature = oneOf(PRICE_NATURES);

/** Display order for lengths inside one offering. */
export const HAIR_LENGTH_ORDER: Record<HairLength, number> = { SHORT: 0, MEDIUM: 1, LONG: 2, EXTRA_LONG: 3 };

/**
 * The sentence under a menu item. Its own description wins; otherwise it
 * borrows its options' text only when every option says the same thing — the
 * short-hair option's "…for short hair" must not describe an item that also
 * covers long and extra-long hair. No sentence beats a misleading one.
 */
export function menuItemDescription(own: string | null | undefined, options: readonly { description: string | null }[]): string | null {
  if (own?.trim()) return own;
  const texts = new Set(options.map((option) => option.description?.trim() ?? ''));
  if (texts.size !== 1) return null;
  const [only] = texts;
  return only || null;
}
