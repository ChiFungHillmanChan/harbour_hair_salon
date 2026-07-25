import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify, SignJWT } from 'jose';
import type { SessionPayload as FullSessionPayload } from '@/app/lib/jwt';
import { SESSION_HINT_COOKIE } from '@/app/lib/session-hint';
import { BOOKING_MAINTENANCE } from '@/app/lib/booking-maintenance';

const secretKey = process.env.SESSION_SECRET;
const key = secretKey ? new TextEncoder().encode(secretKey) : null;

// Mirrors src/app/lib/jwt.ts SessionPayload, but with expiresAt as the string
// it actually is once round-tripped through JSON in the JWT payload.
type SessionPayload = Omit<FullSessionPayload, 'expiresAt'> & { expiresAt: string };

async function getSessionFromRequest(request: NextRequest) {
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

  if (path.startsWith('/book')) {
    // During booking maintenance the page only shows the Treatwell notice, so
    // let everyone see it without forcing a sign-in first.
    if (!BOOKING_MAINTENANCE && !session?.userId) {
      return NextResponse.redirect(new URL('/auth/signin?redirect=/book', request.url));
    }
  }

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
  if (session?.userId && key) {
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
        .sign(key);

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
