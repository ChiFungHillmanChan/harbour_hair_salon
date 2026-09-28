import { createHash, randomBytes } from 'node:crypto';

/**
 * Password-reset token rules, kept free of prisma/next so the decision logic is
 * unit-testable (same pattern as lib/register-gate.ts).
 *
 * Design notes:
 *  - The raw token is emailed but NEVER stored; the database holds only its
 *    SHA-256 hash, so a DB leak cannot be replayed against the reset endpoint.
 *  - SHA-256 (not bcrypt) is correct here: the token is 256 bits of CSPRNG
 *    output, so it has no guessable structure to brute-force, and the reset
 *    endpoint needs a fast exact lookup by hash.
 *  - Tokens are single-use and short-lived.
 */

/** How long a reset link stays valid. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Fresh 256-bit token, URL-safe so it can ride in a query string untouched. */
export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Stable lookup key for a raw token. Hex SHA-256 — 64 chars. */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type ResetTokenRecord = {
  expiresAt: Date;
  usedAt: Date | null;
};

export type ResetTokenVerdict =
  | { ok: true }
  | { ok: false; reason: 'used' | 'expired' };

/**
 * Whether a stored token may still be redeemed. `used` is checked before
 * `expired` so a replay of a consumed token reports the more specific reason.
 */
export function evaluateResetToken(
  record: ResetTokenRecord,
  now: Date = new Date(),
): ResetTokenVerdict {
  if (record.usedAt !== null) return { ok: false, reason: 'used' };
  if (record.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true };
}

// Customer-facing copy (an invalid-link message and the identical
// "if an account exists…" answer that prevents email enumeration) now lives in
// the auth dictionary: auth.errors.INVALID_RESET_LINK and auth.forgot.sent.
