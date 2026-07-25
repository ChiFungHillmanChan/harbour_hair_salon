// Pure decision for "what should /auth/register do with this email?".
//
// Kept dependency-free (no prisma, no next) so it can be unit-tested directly —
// same pattern as services/booking-gates.ts.

export type RegisterOutcome =
  | { kind: 'CREATE' }
  | { kind: 'CLAIM_GUEST' }
  | { kind: 'REJECT'; error: string };

export type ExistingUserFacts = {
  /** Whether the row already has a password hash set. */
  hasPassword: boolean;
  /** How many federated identities (Google, …) are linked to the row. */
  linkedProviderCount: number;
};

export const ALREADY_REGISTERED_ERROR =
  'This email is already registered. Please sign in instead.';

export const USE_GOOGLE_ERROR =
  'This email is already registered with Google. Please use "Continue with Google" to sign in.';

/**
 * Decide the registration path for an email address.
 *
 * The security-critical case is CLAIM_GUEST: it overwrites the row's password
 * and signs the caller straight in, so it must ONLY apply to a true placeholder
 * row that nobody can currently authenticate as.
 *
 * A password-less row is NOT sufficient evidence of that — Google sign-in also
 * creates rows with `password = null`. Treating those as claimable let anyone
 * who knew a customer's email address take over the account (and, for a Google
 * user promoted via promoteGoogleUserToAdmin, the whole admin panel).
 */
export function decideRegistration(existing: ExistingUserFacts | null): RegisterOutcome {
  if (!existing) return { kind: 'CREATE' };

  // Someone can already sign in with a password — never silently overwrite it.
  if (existing.hasPassword) {
    return { kind: 'REJECT', error: ALREADY_REGISTERED_ERROR };
  }

  // Password-less but federated: a real account reachable via its provider.
  // Point the user at the provider rather than letting them claim the row.
  if (existing.linkedProviderCount > 0) {
    return { kind: 'REJECT', error: USE_GOOGLE_ERROR };
  }

  // No password AND no linked provider — nobody can authenticate as this row,
  // so it is a genuine guest placeholder the registrant may claim.
  return { kind: 'CLAIM_GUEST' };
}
