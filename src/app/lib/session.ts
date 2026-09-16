import 'server-only';
import { cache } from 'react';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { encrypt, decrypt, type SessionPayload } from '@/app/lib/jwt';
import { SESSION_HINT_COOKIE } from '@/app/lib/session-hint';
import { sessionLifetimeSeconds, KIOSK_SESSION_SECONDS } from '@/app/lib/session-policy';
import { appendAuditEvent } from '@/app/lib/audit';

function getKey() {
  const secretKey = process.env.SESSION_SECRET;
  if (!secretKey) throw new Error('SESSION_SECRET environment variable is required');
  return new TextEncoder().encode(secretKey);
}

/**
 * Admin sign-in is password-only by product decision: a second factor is NOT
 * required, and nothing in the app asks for one.
 *
 * `adminMfaVerified` is still carried on the token, and the enrol/verify screens
 * under /auth/mfa still work if they are linked to directly, so the requirement
 * can be reinstated by restoring the check in `verifySession` and the redirects
 * in actions/auth.ts and the Google callback. Until then it is never demanded.
 */
export async function createSession(userId: string, role: string, sessionVersion: number, adminMfaVerified = false) {
  const expiresAt = new Date(Date.now() + sessionLifetimeSeconds(role) * 1000);
  const session = await encrypt({ userId, role, sessionVersion, expiresAt, ...(role === 'ADMIN' ? { adminMfaVerified } : {}) });

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

// React cache deduplicates only within the current server render/request; role
// and sessionVersion are re-read on the next request, including Server Actions.
export const verifySession = cache(async () => {
  const cookie = (await cookies()).get('session')?.value;
  const session = await decrypt(cookie);

  if (!session?.userId) {
    redirect('/auth/signin');
  }

  // Re-load the CURRENT role from the database rather than trusting the role
  // baked into the JWT. A user
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
});

export async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') redirect('/');
  return session;
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

async function kioskSessionId(): Promise<string | null> {
  const cookie = (await cookies()).get('kiosk')?.value;
  if (!cookie) return null;
  try {
    const { payload } = await jwtVerify(cookie, getKey(), { algorithms: ['HS256'] });
    if (payload.kiosk !== true || typeof payload.kioskSessionId !== 'string' || !payload.kioskSessionId) return null;
    return payload.kioskSessionId;
  } catch {
    return null;
  }
}

export async function createKioskSession(adminId: string, deviceName = 'Salon kiosk') {
  // Re-enabling this browser replaces its previous device credential.
  await deleteKioskSession(adminId);
  const expiresAt = new Date(Date.now() + KIOSK_SESSION_SECONDS * 1000);
  const device = await prisma.$transaction(async (tx) => {
    const created = await tx.kioskSession.create({
      data: { deviceName, createdByAdminId: adminId, expiresAt }, select: { id: true },
    });
    await appendAuditEvent({ actorUserId: adminId, action: 'KIOSK.ENABLED', targetType: 'KioskSession', targetId: created.id }, tx);
    return created;
  });
  const token = await new SignJWT({ kiosk: true, kioskSessionId: device.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
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
  const id = await kioskSessionId();
  if (!id) return false;
  try {
    const device = await prisma.kioskSession.findUnique({
      where: { id }, select: { revokedAt: true, expiresAt: true },
    });
    return Boolean(device && device.revokedAt === null && device.expiresAt.getTime() > Date.now());
  } catch {
    // A database outage must not turn a revoked device into an accepted one.
    return false;
  }
}

export async function deleteKioskSession(actorUserId?: string) {
  const id = await kioskSessionId();
  if (id) {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.kioskSession.updateMany({
        where: { id, revokedAt: null }, data: { revokedAt: new Date() },
      });
      if (changed.count > 0) await appendAuditEvent({ actorUserId, action: 'KIOSK.REVOKED', targetType: 'KioskSession', targetId: id }, tx);
    });
  }
  (await cookies()).delete('kiosk');
}
