import { ERASED_EMAIL_DOMAIN, isPlaceholderEmail } from './walk-in-customer';

// Pure and client-safe: the Admin -> Users erasure button and the server action
// (actions/admin-erasure.ts) agree on what an erased account looks like and on
// what the admin must type to confirm. Procedure: docs/data-erasure.md.

/** The name an erased customer's account keeps, so past diary entries still read sensibly. */
export const ERASED_CUSTOMER_NAME = 'Erased customer';

/** Typed to confirm erasing a customer who never gave a real email address. */
export const ERASE_CONFIRMATION_WORD = 'ERASE';

/** The unique, permanently undeliverable address an erased account is given. */
export function erasedEmailFor(userId: string): string {
  return `erased-${userId}@${ERASED_EMAIL_DOMAIN}`;
}

export function isErasedEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.toLowerCase().endsWith(`@${ERASED_EMAIL_DOMAIN}`);
}

/** What the admin types: the customer's own address, or ERASE for a phone booking that has none. */
export function erasureConfirmationFor(email: string): string {
  return isPlaceholderEmail(email) ? ERASE_CONFIRMATION_WORD : email;
}

/** Case and surrounding spaces do not matter; anything else does. */
export function erasureConfirmed(typed: string, email: string): boolean {
  return typed.trim().toLowerCase() === erasureConfirmationFor(email).toLowerCase();
}
