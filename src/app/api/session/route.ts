import { NextResponse } from 'next/server';
import { getSession } from '@/app/lib/session';

export const dynamic = 'force-dynamic';

/** Cosmetic header state only; every protected route still verifies server-side. */
export async function GET() {
  const session = await getSession();
  const body = session?.userId
    ? { session: { userId: session.userId, role: session.role } }
    : { session: null };

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  });
}
