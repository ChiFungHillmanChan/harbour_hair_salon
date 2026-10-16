import type { PriceType } from './policy';

/**
 * An NHS-priced option (its name may say "NHS" or "Student & NHS") is only for
 * customers who can prove they qualify; the notice `pricing.eligibilityProof`
 * tells them to bring a valid NHS staff ID or student card.
 */
export function requiresEligibilityProof(service: { priceType: PriceType | string }): boolean {
  return service.priceType === 'NHS';
}
