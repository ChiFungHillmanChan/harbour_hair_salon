import { NextResponse } from 'next/server';
import { getSession } from '@/app/lib/session';
import { SESSION_HINT_COOKIE } from '@/app/lib/session-hint';

export const dynamic = 'force-dynamic';

/**
 * Cosmetic header state only; every protected route still verifies server-side.
 * The header reads the session_hint cookie (back-filled by middleware) and no
 * longer calls this; it stays for pages still open from older deployments and
 * back-fills the hint the same way.
 */
export async function GET() {
  const session = await getSession();
  const body = session?.userId
    ? { session: { userId: session.userId, role: session.role } }
    : { session: null };

  const response = NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  });

  if (session?.userId) {
    response.cookies.set(SESSION_HINT_COOKIE, session.role, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      expires: new Date(session.expiresAt),
      sameSite: 'lax',
      path: '/',
    });
  }

  return response;
}
