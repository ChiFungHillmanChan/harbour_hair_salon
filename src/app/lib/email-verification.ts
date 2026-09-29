import { createHmac } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { SignJWT, jwtVerify } from 'jose';
import { normalizeLocale, type Locale } from '@/i18n/config';

/**
 * Proof that an account receives mail at its address.
 *
 * Registering needs no mailbox, so without this anyone could open accounts on
 * made-up or someone else's addresses and use each one's allowance of booking
 * requests — holding real slots and sending the salon's mail to strangers.
 * Self-service booking therefore requires a verified address.
 *
 * The link is a signed, stateless token: nothing is stored until it is used,
 * and using it twice just confirms the same address again. It names the
 * address it was sent to, so it stops working if the account's address changes.
 *
 * Deliberately not `server-only`: email-service imports it and is loaded in
 * plain Node by its tests. `node:crypto` keeps it out of browser bundles.
 */

const PURPOSE = 'email-verification';
export const EMAIL_VERIFICATION_TTL_HOURS = 48;
/** Far longer than any token we sign; refuse anything bigger unread. */
export const EMAIL_VERIFICATION_TOKEN_MAX_LENGTH = 2048;

function verificationKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET environment variable is required');
  // A key of its own, derived from the session secret, so this token can never
  // be accepted as a session cookie or an OAuth state, nor they as this.
  return createHmac('sha256', secret).update(PURPOSE).digest();
}

export async function createEmailVerificationToken(user: { id: string; email: string }, locale: Locale): Promise<string> {
  return new SignJWT({ purpose: PURPOSE, email: user.email.trim().toLowerCase(), locale })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${EMAIL_VERIFICATION_TTL_HOURS}h`)
    .sign(verificationKey());
}

export type EmailVerificationClaim = { userId: string; email: string; locale: Locale | null };

/** The account and address a link was issued for, or null for anything forged, altered or expired. */
export async function readEmailVerificationToken(token: string): Promise<EmailVerificationClaim | null> {
  if (!token || token.length > EMAIL_VERIFICATION_TOKEN_MAX_LENGTH) return null;
  try {
    const { payload } = await jwtVerify(token, verificationKey(), { algorithms: ['HS256'] });
    if (payload.purpose !== PURPOSE || typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string') return null;
    return {
      userId: payload.sub,
      email: payload.email,
      locale: normalizeLocale(typeof payload.locale === 'string' ? payload.locale : null),
    };
  } catch {
    return null;
  }
}

/** What `hasVerifiedEmail` needs from a User row. */
export const EMAIL_VERIFICATION_SELECT = {
  emailVerifiedAt: true,
  oauthAccounts: { where: { provider: 'google' }, select: { provider: true } },
} satisfies Prisma.UserSelect;

/**
 * Whether the account has proved its address: a verification link or a
 * redeemed password reset (`emailVerifiedAt`), or a linked Google account,
 * whose address Google verified when it was linked.
 */
export function hasVerifiedEmail(user: { emailVerifiedAt: Date | null; oauthAccounts: { provider: string }[] }): boolean {
  return user.emailVerifiedAt !== null || user.oauthAccounts.some((account) => account.provider === 'google');
}
