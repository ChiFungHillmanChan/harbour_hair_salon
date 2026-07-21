import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { encrypt, decrypt, type SessionPayload } from '@/app/lib/jwt';
import { SESSION_HINT_COOKIE } from '@/app/lib/session-hint';

function getKey() {
  const secretKey = process.env.SESSION_SECRET;
  if (!secretKey) throw new Error('SESSION_SECRET environment variable is required');
  return new TextEncoder().encode(secretKey);
}

export async function createSession(userId: string, role: string, sessionVersion: number) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  const session = await encrypt({ userId, role, sessionVersion, expiresAt });

  const cookieStore = await cookies();
  cookieStore.set('session', session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    sameSite: 'lax',
    path: '/',
  });
  // Readable by the header client for instant, network-free account links.
  cookieStore.set(SESSION_HINT_COOKIE, role, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    sameSite: 'lax',
    path: '/',
  });
}

export async function refreshSession() {
  const cookie = (await cookies()).get('session')?.value;
  const session = await decrypt(cookie);
  if (!session?.userId) return;

  // Refresh if less than 7 days remaining
  const timeLeft = new Date(session.expiresAt).getTime() - Date.now();
  if (timeLeft < 7 * 24 * 60 * 60 * 1000) {
    await createSession(session.userId, session.role, session.sessionVersion ?? 0);
  }
}

export async function verifySession() {
  const cookie = (await cookies()).get('session')?.value;
  const session = await decrypt(cookie);

  if (!session?.userId) {
    redirect('/auth/signin');
  }

  // Re-load the CURRENT role from the database rather than trusting the role
  // baked into the (up-to-30-day) JWT. This closes the revocation gap: a user
  // who was demoted from ADMIN, or deleted, immediately loses access instead of
  // keeping it until their cookie expires. One indexed primary-key lookup.
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { role: true, sessionVersion: true },
  });

  if (!user) {
    // Account no longer exists — treat the stale cookie as unauthenticated.
    redirect('/auth/signin');
  }

  // Tokens issued before this field existed have no claim → treat as 0, which
  // matches a freshly-migrated user (default 0). A password reset bumps the
  // stored version, invalidating every previously-issued token.
  const tokenVersion = session.sessionVersion ?? 0;
  if (user.sessionVersion !== tokenVersion) {
    redirect('/auth/signin');
  }

  return { userId: session.userId, role: user.role };
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookie = (await cookies()).get('session')?.value;
  const session = await decrypt(cookie);
  return session;
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete('session');
  cookieStore.delete(SESSION_HINT_COOKIE);
}

type KioskPayload = { kiosk: true; expiresAt: Date };

export async function createKioskSession() {
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
  const token = await new SignJWT({ kiosk: true, expiresAt })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('365d')
    .sign(getKey());

  (await cookies()).set('kiosk', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    sameSite: 'lax',
    path: '/',
  });
}

export async function getKioskSession(): Promise<boolean> {
  const cookie = (await cookies()).get('kiosk')?.value;
  if (!cookie) return false;
  try {
    const { payload } = await jwtVerify(cookie, getKey(), { algorithms: ['HS256'] });
    return (payload as unknown as KioskPayload).kiosk === true;
  } catch {
    return false;
  }
}

export async function deleteKioskSession() {
  (await cookies()).delete('kiosk');
}

