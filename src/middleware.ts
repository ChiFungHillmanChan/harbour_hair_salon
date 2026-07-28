import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify, SignJWT } from 'jose';
import type { SessionPayload as FullSessionPayload } from '@/app/lib/jwt';
import { SESSION_HINT_COOKIE } from '@/app/lib/session-hint';

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
    return (payload as { kiosk?: boolean }).kiosk === true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const session = await getSessionFromRequest(request);

  if (path.startsWith('/admin')) {
    if (!session?.userId) {
      return NextResponse.redirect(new URL('/auth/signin', request.url));
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  if (path.startsWith('/kiosk')) {
    const isAdmin = session?.userId && session.role === 'ADMIN';
    const isKiosk = await hasKioskCookie(request);
    if (!isAdmin && !isKiosk) {
      return NextResponse.redirect(new URL('/auth/signin?redirect=/kiosk', request.url));
    }
  }

  if (path.startsWith('/appointments')) {
    if (!session?.userId) {
      return NextResponse.redirect(new URL('/auth/signin?redirect=/appointments', request.url));
    }
  }

  // NOTE: /book deliberately has no auth gate here any more. Whether booking is
  // open now lives in the database (SiteSettings.bookingEnabled), and middleware
  // runs on every matched request — querying Neon from here would add a DB
  // round-trip to each one. The gate moved into src/app/book/page.tsx, which
  // already renders server-side and can read both the setting and the session.
  // This costs nothing in security: every booking action independently calls
  // verifySession(), so the middleware check was only an early UX redirect.

  if (path.startsWith('/reviews/new')) {
    if (!session?.userId) {
      const target = `/auth/signin?redirect=${encodeURIComponent(path + request.nextUrl.search)}`;
      return NextResponse.redirect(new URL(target, request.url));
    }
  }

  // Expose the current pathname to server components (root layout reads this
  // via headers() to decide whether to render the marketing chrome).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', path);

  // Sliding session: refresh token if less than 7 days remaining
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const signingKey = getKey();
  if (session?.userId && signingKey) {
    const timeLeft = new Date(session.expiresAt).getTime() - Date.now();
    if (timeLeft < 7 * 24 * 60 * 60 * 1000 && timeLeft > 0) {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const newToken = await new SignJWT({
        userId: session.userId,
        role: session.role,
        sessionVersion: session.sessionVersion ?? 0,
        expiresAt,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('30d')
        .sign(signingKey);

      response.cookies.set('session', newToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        expires: expiresAt,
        sameSite: 'lax',
        path: '/',
      });
      response.cookies.set(SESSION_HINT_COOKIE, session.role, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        expires: expiresAt,
        sameSite: 'lax',
        path: '/',
      });
    } else if (request.cookies.get(SESSION_HINT_COOKIE)?.value !== session.role) {
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
  matcher: ['/admin/:path*', '/appointments/:path*', '/book/:path*', '/reviews/new', '/kiosk/:path*'],
};
