import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import type { SessionPayload as FullSessionPayload } from '@/app/lib/jwt';
import { SESSION_HINT_COOKIE } from '@/app/lib/session-hint';
import { isWithinSessionLifetime } from '@/app/lib/session-policy';
import { LOCALE_HEADER, LOCALE_SEGMENT, DEFAULT_LOCALE, type Locale } from '@/i18n/config';
import { localizeHref, splitLocalePath } from '@/i18n/paths';

// Resolve the signing key per request rather than once at module load, and warn
// loudly if it is missing — so an unset SESSION_SECRET surfaces in the logs as a
// misconfiguration instead of silently bouncing every protected route to signin.
function getKey(): Uint8Array | null {
  const secretKey = process.env.SESSION_SECRET;
  if (!secretKey) {
    console.error('SESSION_SECRET is not set — all protected routes will reject.');
    return null;
  }
  return new TextEncoder().encode(secretKey);
}

// Mirrors src/app/lib/jwt.ts SessionPayload, but with expiresAt as the string
// it actually is once round-tripped through JSON in the JWT payload.
type SessionPayload = Omit<FullSessionPayload, 'expiresAt'> & { expiresAt: string };

async function getSessionFromRequest(request: NextRequest) {
  const key = getKey();
  if (!key) return null;
  const cookie = request.cookies.get('session')?.value;
  if (!cookie) return null;
  try {
    const { payload } = await jwtVerify(cookie, key, { algorithms: ['HS256'] });
    if (!isWithinSessionLifetime(payload.role, payload.iat)) return null;
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

async function hasKioskCookie(request: NextRequest): Promise<boolean> {
  const key = getKey();
  if (!key) return false;
  const cookie = request.cookies.get('kiosk')?.value;
  if (!cookie) return false;
  try {
    const { payload } = await jwtVerify(cookie, key, { algorithms: ['HS256'] });
    // Optimistic only: kiosk data/actions also check the registered device's
    // expiry/revocation in the database before reading or changing anything.
    return payload.kiosk === true && typeof payload.kioskSessionId === 'string' && Boolean(payload.kioskSessionId);
  } catch {
    return false;
  }
}

/** Routes whose middleware gate needs the session cookie decoded. */
const PROTECTED_PREFIXES = ['/admin', '/kiosk', '/appointments', '/reviews/new', '/book'];

function isUnder(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Order matters and is the whole point of this function:
 *
 *   1. identify and validate the language prefix (only /zh-hk is public; the
 *      internal /en-gb segment is never addressable),
 *   2. reduce the URL to its language-free business path,
 *   3. apply the SAME permission rules as before to that business path — so a
 *      /zh-hk/admin URL is exactly as protected as /admin, and a new language
 *      can never become a way around a gate,
 *   4. send redirects (sign-in, home) to the visitor's language, with the
 *      post-login target still a same-site relative path that sanitizeRedirect
 *      accepts.
 *
 * The language cookie is never consulted here: an explicit URL always wins,
 * and an unprefixed URL is English.
 */
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // The internal English segment must never become a second public URL.
  const internalEnglish = `/${LOCALE_SEGMENT[DEFAULT_LOCALE]}`;
  if (pathname === internalEnglish || pathname.startsWith(`${internalEnglish}/`)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(internalEnglish.length) || '/';
    return NextResponse.redirect(url, 308);
  }

  const { locale, path } = splitLocalePath(pathname);
  const toLocale = (target: string) => new URL(localizeHref(locale, target), request.url);
  const session = PROTECTED_PREFIXES.some((prefix) => isUnder(path, prefix))
    ? await getSessionFromRequest(request)
    : null;

  if (isUnder(path, '/admin')) {
    if (!session?.userId) {
      return NextResponse.redirect(toLocale('/auth/signin'));
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.redirect(toLocale('/'));
    }
  }

  if (isUnder(path, '/kiosk')) {
    const isAdmin = session?.userId && session.role === 'ADMIN';
    const isKiosk = await hasKioskCookie(request);
    if (!isAdmin && !isKiosk) {
      return NextResponse.redirect(toLocale(`/auth/signin?redirect=${encodeURIComponent(localizeHref(locale, '/kiosk'))}`));
    }
  }

  if (isUnder(path, '/appointments')) {
    if (!session?.userId) {
      return NextResponse.redirect(toLocale(`/auth/signin?redirect=${encodeURIComponent(localizeHref(locale, '/appointments'))}`));
    }
  }

  // NOTE: /book deliberately has no auth gate here any more. Whether booking is
  // open now lives in the database (SiteSettings.bookingEnabled), and middleware
  // runs on every matched request — querying Neon from here would add a DB
  // round-trip to each one. The gate moved into src/app/[locale]/book/page.tsx,
  // which already renders server-side and can read both the setting and the
  // session. This costs nothing in security: every booking action independently
  // calls verifySession(), so the middleware check was only an early UX redirect.

  if (isUnder(path, '/reviews/new')) {
    if (!session?.userId) {
      const target = `/auth/signin?redirect=${encodeURIComponent(pathname + request.nextUrl.search)}`;
      return NextResponse.redirect(toLocale(target));
    }
  }

  // Server Actions POST to the page URL, so they pass through here too and
  // receive the validated language on a header they cannot forge (it is
  // always overwritten below).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', path);
  requestHeaders.set(LOCALE_HEADER, locale satisfies Locale);

  // English keeps its unprefixed public URL: serve it from the internal
  // /en-gb segment. /zh-hk/... already matches app/[locale] as it is.
  let response: NextResponse;
  if (locale === DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = `${internalEnglish}${pathname === '/' ? '' : pathname}`;
    response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Backfill the cosmetic hint only. Navigation never renews a session using
  // claims that may already have been revoked in the database.
  if (session?.userId) {
    if (request.cookies.get(SESSION_HINT_COOKIE)?.value !== session.role) {
      // Back-fill for sessions issued before the hint cookie existed (or after
      // a role change) so the header shows account links without a fetch.
      response.cookies.set(SESSION_HINT_COOKIE, session.role, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        expires: new Date(session.expiresAt),
        sameSite: 'lax',
        path: '/',
      });
    }
  }

  return response;
}

export const config = {
  // Every page, in both languages. Excluded — and therefore unchanged by this
  // work: API routes (OAuth callback, cron, ICS feeds, health), Next internals
  // and any path with a file extension (public assets, robots.txt,
  // sitemap.xml, the Search Console verification file).
  matcher: ['/((?!api/|_next/|_vercel/|\\.well-known/|.*\\.[A-Za-z0-9]+$).*)'],
};
