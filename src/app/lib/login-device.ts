import 'server-only';
import { createHmac } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { accountRateLimitKey } from '@/app/lib/rate-limit';

/**
 * "This browser has signed in to this account before" — OWASP's device cookie.
 *
 * The per-account login bucket (lib/rate-limit.ts) is spent by every attempt at
 * an address, so anyone who knows the owner's email could keep it empty and
 * lock the owner out of password sign-in for as long as they liked. A browser
 * holding this cookie for the account skips that bucket (the per-IP one still
 * applies): the owner's own devices keep working, while guesses from anywhere
 * else stay capped. Only a correct password earns the cookie, so a guesser
 * can never hold one for an account they have not already signed in to.
 */
export const LOGIN_DEVICE_COOKIE = 'login_device';
const PURPOSE = 'login-device';
const LIFETIME_SECONDS = 180 * 86_400;
/** Accounts remembered per browser; a shared salon tablet may sign in to a few. */
const MAX_ACCOUNTS = 5;

function deviceKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET environment variable is required');
  // A key of its own, so this cookie can never pass as a session, and no other
  // token signed from the session secret can pass as this.
  return createHmac('sha256', secret).update(PURPOSE).digest();
}

/** Account keys a genuine cookie vouches for; empty for a missing, forged or expired one. */
async function rememberedAccounts(token: string | undefined): Promise<string[]> {
  if (!token || token.length > 1024) return [];
  try {
    const { payload } = await jwtVerify(token, deviceKey(), { algorithms: ['HS256'] });
    if (payload.purpose !== PURPOSE || !Array.isArray(payload.accounts)) return [];
    return payload.accounts.filter((account): account is string => typeof account === 'string');
  } catch {
    return [];
  }
}

export async function isRecognisedLoginDevice(email: string): Promise<boolean> {
  const accounts = await rememberedAccounts((await cookies()).get(LOGIN_DEVICE_COOKIE)?.value);
  return accounts.includes(accountRateLimitKey(email));
}

/** Call after a correct password: this browser may skip the account bucket next time. */
export async function rememberLoginDevice(email: string): Promise<void> {
  const store = await cookies();
  const key = accountRateLimitKey(email);
  const previous = await rememberedAccounts(store.get(LOGIN_DEVICE_COOKIE)?.value);
  const accounts = [key, ...previous.filter((account) => account !== key)].slice(0, MAX_ACCOUNTS);
  const token = await new SignJWT({ purpose: PURPOSE, accounts })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + LIFETIME_SECONDS)
    .sign(deviceKey());
  store.set(LOGIN_DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: LIFETIME_SECONDS,
  });
}
