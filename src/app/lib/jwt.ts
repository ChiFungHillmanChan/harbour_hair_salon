import 'server-only';
import { SignJWT, jwtVerify } from 'jose';

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
};

export async function encrypt(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getKey());
}

export async function decrypt(session: string | undefined = ''): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(session, getKey(), { algorithms: ['HS256'] });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
