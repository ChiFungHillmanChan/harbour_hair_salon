import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decrypt } from '@/app/lib/session';
import { cookies } from 'next/headers';

export async function proxy(request: NextRequest) {
  const protectedRoutes = ['/admin'];
  const currentPath = request.nextUrl.pathname;
  const isProtectedRoute = protectedRoutes.some(route => currentPath.startsWith(route));

  if (isProtectedRoute) {
    const cookie = (await cookies()).get('session')?.value;
    const session = await decrypt(cookie);

    if (!session?.userId) {
      return NextResponse.redirect(new URL('/auth/signin', request.nextUrl));
    }

    if (currentPath.startsWith('/admin') && session.role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/', request.nextUrl));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};

