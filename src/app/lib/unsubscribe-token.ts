// No 'server-only' marker: email-service imports this and must keep loading
// under the plain Node renderer (email-transport.test.ts), like
// lib/password-reset.ts. node:crypto already keeps it out of client bundles.
import { createHmac } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { SITE_URL } from '@/app/lib/site-url';
import type { Locale } from '@/i18n/config';
import { localizeHref } from '@/i18n/paths';

/**
 * Proof that whoever opens an unsubscribe link received it at that address.
 *
 * The unsubscribe form used to switch marketing off for any address typed into
 * it, so knowing someone's email was enough to unsubscribe them. Now the form
 * only emails this signed link, and the list changes when the link is used.
 *
 * The key is derived from SESSION_SECRET for this one purpose, so an
 * unsubscribe token can never verify as a session or OAuth-state token (both
 * signed with the raw secret), nor the other way round.
 */
export const UNSUBSCRIBE_TOKEN_PURPOSE = 'marketing-unsubscribe';
export const UNSUBSCRIBE_TOKEN_TTL_DAYS = 30;

function getKey(): Uint8Array {
  // Read at call time, never at module load (project convention).
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET environment variable is required');
  return createHmac('sha256', secret).update(UNSUBSCRIBE_TOKEN_PURPOSE).digest();
}

export function normalizeMarketingEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createUnsubscribeToken(email: string, now: Date = new Date()): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ purpose: UNSUBSCRIBE_TOKEN_PURPOSE, email: normalizeMarketingEmail(email) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + UNSUBSCRIBE_TOKEN_TTL_DAYS * 86_400)
    .sign(getKey());
}

/** The address a genuine, unexpired link was issued for; null for anything else. */
export async function verifyUnsubscribeToken(token: string, now: Date = new Date()): Promise<string | null> {
  if (!token || token.length > 2048) return null;
  try {
    const { payload } = await jwtVerify(token, getKey(), { algorithms: ['HS256'], currentDate: now });
    if (payload.purpose !== UNSUBSCRIBE_TOKEN_PURPOSE || typeof payload.email !== 'string') return null;
    const email = normalizeMarketingEmail(payload.email);
    return email ? email : null;
  } catch {
    return null;
  }
}

/** The page a link lands on, in the language it was sent in. */
export function unsubscribeUrl(token: string, locale: Locale): string {
  return `${SITE_URL}${localizeHref(locale, '/unsubscribe')}?token=${encodeURIComponent(token)}`;
}

/** A ready-made link for a marketing email's footer or List-Unsubscribe header. */
export async function createUnsubscribeUrl(email: string, locale: Locale): Promise<string> {
  return unsubscribeUrl(await createUnsubscribeToken(email), locale);
}
