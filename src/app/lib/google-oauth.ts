import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { sanitizeRedirect } from '@/app/lib/redirect';
import { isParseableUrl } from '@/app/lib/site-url';
import { normalizeLocale, type Locale } from '@/i18n/config';

const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export const GOOGLE_OAUTH_STATE_COOKIE = 'google_oauth_state';

type OAuthState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectTo: string;
  /**
   * Language of the page the visitor started from. The callback URL is
   * registered with Google and has no language of its own, so the language
   * travels in this signed state instead. Absent on states issued before it
   * existed.
   */
  locale?: Locale;
};

export type GoogleProfile = {
  id: string;
  email: string;
  name: string | null;
  /**
   * Whether Google is the authority for `email` — see
   * isGoogleAuthoritativeEmail. When it is not, `email_verified` only says the
   * address was confirmed once, possibly for a previous owner.
   */
  emailAuthoritative: boolean;
};

/**
 * Google's own rule for when a verified `email` proves the signer controls the
 * address TODAY: a Gmail address, or a Google Workspace account (the `hd`
 * claim). A Google account can also be registered on any third-party address;
 * Google verified it at sign-up, but that mailbox may since have changed hands
 * while `email_verified` stays true.
 * https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
 */
export function isGoogleAuthoritativeEmail(email: string, hostedDomain: unknown): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  // googlemail.com is Gmail's older UK domain, still used by some accounts.
  if (domain === 'gmail.com' || domain === 'googlemail.com') return true;
  return typeof hostedDomain === 'string' && hostedDomain.trim().length > 0;
}

export type GoogleSignInRefusal = 'google_email_unverified' | 'google_admin_link';

export type GoogleLinkDecision =
  | { kind: 'CREATE' }
  | { kind: 'LINK'; clearPassword: boolean }
  | { kind: 'REFUSE'; code: GoogleSignInRefusal };

/**
 * What a first Google sign-in (no account linked to this Google id yet) may do.
 * An already linked Google id never reaches here: it signs in by `sub`.
 *
 *  - Google not authoritative for the address → refuse outright. Linking would
 *    hand an existing account to whoever holds a stale Google identity, and
 *    creating one would leave that identity inside an account the real owner
 *    later recovers by email.
 *  - Existing administrator → refuse. Staff accounts are never taken over by an
 *    email match; they sign in with their password.
 *  - Existing customer → link, destroying a password that may have been planted
 *    by someone who pre-registered the address (the owner has just proved it).
 */
export function decideGoogleLink(
  profile: Pick<GoogleProfile, 'emailAuthoritative'>,
  existing: { role: string; hasPassword: boolean } | null,
): GoogleLinkDecision {
  if (!profile.emailAuthoritative) return { kind: 'REFUSE', code: 'google_email_unverified' };
  if (!existing) return { kind: 'CREATE' };
  if (existing.role !== 'USER') return { kind: 'REFUSE', code: 'google_admin_link' };
  return { kind: 'LINK', clearPassword: existing.hasPassword };
}

function getSessionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET environment variable is required');
  return new TextEncoder().encode(secret);
}

export function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth is not configured');
  }
  return { clientId, clientSecret };
}

export function resolveOAuthOrigin(requestOrigin: string, productionSiteUrl?: string): string {
  const candidate = productionSiteUrl?.trim() || requestOrigin;
  const url = new URL(candidate);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('OAuth origin must use HTTPS outside local development');
  }
  return url.origin;
}

export function getGoogleCallbackUrl(requestOrigin: string): string {
  const raw = process.env.NODE_ENV === 'production'
    ? process.env.NEXT_PUBLIC_SITE_URL?.trim()
    : undefined;
  // GH Actions builds inline NEXT_PUBLIC_* as the literal "[SENSITIVE]"
  // placeholder (see site-url.ts); fall back to the request origin then.
  const configuredSiteUrl = raw && isParseableUrl(raw) ? raw : undefined;
  return `${resolveOAuthOrigin(requestOrigin, configuredSiteUrl)}/api/auth/google/callback`;
}

function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export async function createGoogleAuthorization(
  requestOrigin: string,
  redirect: string | null,
  locale?: Locale
): Promise<{ authorizationUrl: string; stateCookie: string }> {
  const { clientId } = getGoogleConfig();
  const callbackUrl = getGoogleCallbackUrl(requestOrigin);
  const state: OAuthState = {
    state: randomUrlSafe(),
    nonce: randomUrlSafe(),
    codeVerifier: randomUrlSafe(48),
    redirectTo: sanitizeRedirect(redirect),
    ...(locale ? { locale } : {}),
  };

  const codeChallenge = createHash('sha256').update(state.codeVerifier).digest('base64url');
  const stateCookie = await new SignJWT(state)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(getSessionKey());

  const url = new URL(GOOGLE_AUTHORIZATION_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state.state);
  url.searchParams.set('nonce', state.nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');

  return { authorizationUrl: url.toString(), stateCookie };
}

export async function readGoogleState(
  stateCookie: string | undefined,
  returnedState: string | null
): Promise<OAuthState> {
  if (!stateCookie || !returnedState) throw new Error('Missing OAuth state');
  const { payload } = await jwtVerify(stateCookie, getSessionKey(), { algorithms: ['HS256'] });
  const state = payload as unknown as OAuthState;
  if (!state.state || state.state !== returnedState || !state.nonce || !state.codeVerifier) {
    throw new Error('Invalid OAuth state');
  }
  return { ...state, redirectTo: sanitizeRedirect(state.redirectTo), locale: normalizeLocale(state.locale) ?? undefined };
}

/**
 * The language stored in a state cookie we signed, WITHOUT the state/CSRF
 * checks — only to word the sign-in error page when the flow fails before
 * (or while) readGoogleState runs. It chooses between our two dictionaries
 * and nothing else; every security decision still goes through
 * readGoogleState.
 */
export async function readGoogleStateLocale(stateCookie: string | undefined): Promise<Locale | null> {
  if (!stateCookie) return null;
  try {
    const { payload } = await jwtVerify(stateCookie, getSessionKey(), { algorithms: ['HS256'] });
    return normalizeLocale(typeof payload.locale === 'string' ? payload.locale : null);
  } catch {
    return null;
  }
}

export async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
  callbackUrl: string
): Promise<string> {
  const { clientId, clientSecret } = getGoogleConfig();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
    cache: 'no-store',
    // A stalled Google endpoint must fail into the normal sign-in error page,
    // not hold the callback until the function's 300-second limit (a 504).
    signal: AbortSignal.timeout(10_000),
  });

  const tokens = await response.json() as { id_token?: string; error?: string };
  if (!response.ok || !tokens.id_token) {
    throw new Error(`Google token exchange failed: ${tokens.error || response.status}`);
  }
  return tokens.id_token;
}

export async function verifyGoogleIdToken(idToken: string, nonce: string): Promise<GoogleProfile> {
  const { clientId } = getGoogleConfig();
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    algorithms: ['RS256'],
    audience: clientId,
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
  });

  if (payload.nonce !== nonce || !payload.sub || typeof payload.email !== 'string' || payload.email_verified !== true) {
    throw new Error('Google did not return a verified identity');
  }

  const email = payload.email.trim().toLowerCase();
  return {
    id: payload.sub,
    email,
    name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null,
    emailAuthoritative: isGoogleAuthoritativeEmail(email, payload.hd),
  };
}

export function getGoogleOAuthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/auth/google',
    maxAge: 10 * 60,
  };
}
