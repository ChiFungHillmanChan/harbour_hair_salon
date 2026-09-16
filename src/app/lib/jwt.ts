import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { isWithinSessionLifetime } from '@/app/lib/session-policy';

function getKey() {
  const secretKey = process.env.SESSION_SECRET;
  if (!secretKey) throw new Error('SESSION_SECRET environment variable is required');
  return new TextEncoder().encode(secretKey);
}

export type SessionPayload = {
  userId: string;
  role: string;
  sessionVersion: number;
  expiresAt: Date;
  adminMfaVerified?: boolean;
};

export async function encrypt(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(payload.expiresAt.getTime() / 1000))
    .sign(getKey());
}

export async function decrypt(session: string | undefined = ''): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(session, getKey(), { algorithms: ['HS256'] });
    if (!isWithinSessionLifetime(payload.role, payload.iat)) return null;
    if (typeof payload.userId !== 'string' || !payload.userId) return null;
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
