// Registration creates new users only. Recovering an existing account requires
// an emailed, single-use password-reset token or its verified OAuth identity.

export type RegisterOutcome =
  | { kind: 'CREATE' }
  | { kind: 'REJECT'; error: string };

export type ExistingUserFacts = {
  /** Whether the row already has a password hash set. */
  hasPassword: boolean;
  /** How many federated identities (Google, …) are linked to the row. */
  linkedProviderCount: number;
};

export const ALREADY_REGISTERED_ERROR =
  'This email is already registered. Please sign in or use Forgot password to verify your email and recover access.';

export const USE_GOOGLE_ERROR =
  'This email is already registered with Google. Please use "Continue with Google" to sign in.';

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

  // A guest's history still belongs to the email owner. Knowing the address
  // does not prove ownership, even when no password/provider has been set yet.
  return { kind: 'REJECT', error: ALREADY_REGISTERED_ERROR };
}
