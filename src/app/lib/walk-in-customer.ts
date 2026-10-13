/**
 * Customer identity for bookings the salon takes by phone, WhatsApp or over the
 * counter.
 *
 * Pure and Prisma-free so the rules below can be unit-tested directly.
 *
 * The salon frequently books someone who has never used the website and has no
 * email address to give. `User.email` is required and unique, so those rows get
 * a synthesised address on an **unroutable** domain instead:
 *
 *  - `.invalid` is reserved by RFC 2606 and can never resolve, so a placeholder
 *    can't silently mail a stranger if it ever leaks into the outbox.
 *  - `isPlaceholderEmail` is the gate every notification path checks, so a
 *    walk-in never generates a delivery attempt (and 12 retries) to nowhere.
 *  - A placeholder row is password-less, exactly like a guest row created by the
 *    old booking flow, so nothing new becomes claimable at /auth/register.
 */

export const PLACEHOLDER_EMAIL_DOMAIN = 'walk-in.harbourhair.invalid';

/** A synthetic, permanently-undeliverable address for a customer with no email. */
export function placeholderEmailFor(token: string): string {
  const slug = token.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40) || 'customer';
  return `${slug}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

/**
 * The domain an erased customer's address is moved to (lib/customer-erasure.ts).
 * Also reserved by RFC 2606, and treated as a placeholder below so nothing —
 * no reminder, review request or lapse notice — is ever queued for it.
 */
export const ERASED_EMAIL_DOMAIN = 'erased.invalid';

/** True when this address exists only to satisfy the unique column — never mail it. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (typeof email !== 'string') return false;
  const address = email.toLowerCase();
  return address.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`) || address.endsWith(`@${ERASED_EMAIL_DOMAIN}`);
}

/** Strip a placeholder back to nothing, so admin screens show a blank field. */
export function displayableEmail(email: string | null | undefined): string {
  return !email || isPlaceholderEmail(email) ? '' : email;
}
