import 'server-only';
import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { deleteSession } from '@/app/lib/session';
import { localizedPath } from '@/i18n/request';

const CHALLENGE_COOKIE = 'admin_mfa_pending';
// Site-wide, not '/auth/mfa': the challenge must also reach /zh-hk/auth/mfa
// (and its Server Action POSTs), including after switching language mid-setup.
// A cookie has one path, and a path is no boundary within one origin anyway.
const CHALLENGE_PATH = '/';

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is required');
  return new TextEncoder().encode(secret);
}

export async function beginAdminMfaChallenge(userId: string, sessionVersion: number) {
  await deleteSession();
  const token = await new SignJWT({ purpose: 'admin-mfa', userId, sessionVersion, nonce: randomBytes(24).toString('base64url') })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(key());
  (await cookies()).set(CHALLENGE_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: CHALLENGE_PATH, maxAge: 300 });
}

export async function clearAdminMfaChallenge() {
  (await cookies()).set(CHALLENGE_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: CHALLENGE_PATH, maxAge: 0 });
}

/** Sign-in again, in the visitor's language, returning to the admin panel. */
async function restartSignIn() {
  return localizedPath(`/auth/signin?redirect=${encodeURIComponent(await localizedPath('/admin'))}`);
}

export async function requirePendingAdminMfa() {
  const cookie = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  let identity: { userId: string; sessionVersion: number } | null = null;
  try {
    const { payload } = await jwtVerify(cookie ?? '', key(), { algorithms: ['HS256'] });
    if (payload.purpose === 'admin-mfa' && typeof payload.userId === 'string' && typeof payload.sessionVersion === 'number' && typeof payload.nonce === 'string') {
      identity = { userId: payload.userId, sessionVersion: payload.sessionVersion };
    }
  } catch { /* No first-factor proof: the sign-in flow must run again. */ }
  if (!identity) redirect(await restartSignIn());
  const user = await prisma.user.findUnique({
    where: { id: identity.userId },
    select: {
      id: true, email: true, role: true, password: true, sessionVersion: true,
      mfaEnabledAt: true, mfaSecretEncrypted: true, mfaLastUsedStep: true,
      mfaRecoveryCodesJson: true, mfaPendingSecretEncrypted: true, mfaPendingExpiresAt: true,
    },
  });
  if (!user || user.role !== 'ADMIN' || user.sessionVersion !== identity.sessionVersion) redirect(await restartSignIn());
  return user;
}
