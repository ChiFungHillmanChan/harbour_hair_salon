import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify, SignJWT } from 'jose';

const secretKey = process.env.SESSION_SECRET;
const key = secretKey ? new TextEncoder().encode(secretKey) : null;

type SessionPayload = { userId: string; role: string; expiresAt: string };

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

  if (path.startsWith('/appointments')) {
    if (!session?.userId) {
      return NextResponse.redirect(new URL('/auth/signin?redirect=/appointments', request.url));
    }
  }

  if (path.startsWith('/book')) {
    if (!session?.userId) {
      return NextResponse.redirect(new URL('/auth/signin?redirect=/book', request.url));
    }
  }

  // Sliding session: refresh token if less than 7 days remaining
  const response = NextResponse.next();
  if (session?.userId && key) {
    const timeLeft = new Date(session.expiresAt).getTime() - Date.now();
    if (timeLeft < 7 * 24 * 60 * 60 * 1000 && timeLeft > 0) {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const newToken = await new SignJWT({ userId: session.userId, role: session.role, expiresAt })
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
    }
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/appointments/:path*', '/book/:path*'],
};
