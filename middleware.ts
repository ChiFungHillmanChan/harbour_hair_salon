import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const secretKey = process.env.SESSION_SECRET;
if (!secretKey) {
  console.error('CRITICAL: SESSION_SECRET is not set. All protected routes will be inaccessible.');
}
const key = new TextEncoder().encode(secretKey ?? '');

async function getSessionFromRequest(request: NextRequest) {
  const cookie = request.cookies.get('session')?.value;
  if (!cookie) return null;
  try {
    const { payload } = await jwtVerify(cookie, key, { algorithms: ['HS256'] });
    return payload as unknown as { userId: string; role: string };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (path.startsWith('/admin')) {
    const session = await getSessionFromRequest(request);
    if (!session?.userId) {
      return NextResponse.redirect(new URL('/auth/signin', request.url));
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  if (path.startsWith('/appointments')) {
    const session = await getSessionFromRequest(request);
    if (!session?.userId) {
      return NextResponse.redirect(new URL('/auth/signin?redirect=/appointments', request.url));
    }
  }

  if (path.startsWith('/book')) {
    const session = await getSessionFromRequest(request);
    if (!session?.userId) {
      return NextResponse.redirect(new URL('/auth/signin?redirect=/book', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/appointments/:path*', '/book/:path*'],
};
