import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

function getKey() {
  const secretKey = process.env.SESSION_SECRET;
  if (!secretKey) throw new Error('SESSION_SECRET environment variable is required');
  return new TextEncoder().encode(secretKey);
}

type SessionPayload = {
  userId: string;
  role: string;
  expiresAt: Date;
};

export async function encrypt(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getKey());
}

export async function decrypt(session: string | undefined = '') {
  try {
    const { payload } = await jwtVerify(session, getKey(), {
      algorithms: ['HS256'],
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function createSession(userId: string, role: string) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  const session = await encrypt({ userId, role, expiresAt });

  (await cookies()).set('session', session, {
    httpOnly: true,
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
    await createSession(session.userId, session.role);
  }
}

export async function verifySession() {
  const cookie = (await cookies()).get('session')?.value;
  const session = await decrypt(cookie);

  if (!session?.userId) {
    redirect('/auth/signin');
  }

  return { userId: session.userId, role: session.role };
}

export async function getSession() {
  const cookie = (await cookies()).get('session')?.value;
  const session = await decrypt(cookie);
  return session;
}

export async function deleteSession() {
  (await cookies()).delete('session');
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

