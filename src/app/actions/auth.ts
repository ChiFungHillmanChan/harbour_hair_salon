'use server';

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '@/app/lib/prisma';
import { fitsBcryptLimit, hashPassword, verifyPassword } from '@/app/lib/password';
import { createSession, deleteSession } from '@/app/lib/session';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { accountRateLimitKey, loginAccountLimiter, loginLimiter, registerLimiter } from '@/app/lib/rate-limit';
import { postSignInPath } from '@/app/lib/post-auth-redirect';
import { isRecognisedLoginDevice, rememberLoginDevice } from '@/app/lib/login-device';
import { decideRegistration } from '@/app/lib/register-gate';
import { appendAuditEvent } from '@/app/lib/audit';
import { getActionT, localizedPath } from '@/i18n/request';

function getClientIp(headersList: Headers): string {
  const forwarded = headersList.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

// Rate limiting (Redis-backed, with an in-process fallback) lives in
// lib/rate-limit.ts so an unset UPSTASH_* env degrades the limit instead of
// removing it.

// Messages are codes, translated into the caller's language below.
const loginSchema = z.object({
  email: z.string().email('EMAIL_INVALID').max(254, 'EMAIL_TOO_LONG'),
  password: z.string().min(1, 'PASSWORD_REQUIRED').max(128, 'PASSWORD_TOO_LONG'),
});

const registerSchema = z.object({
  name: z.string().min(2, 'NAME_TOO_SHORT').max(100, 'NAME_TOO_LONG'),
  email: z.string().email('EMAIL_INVALID').max(254, 'EMAIL_TOO_LONG'),
  // 8 minimum, matching the admin-user schema in actions/admin.ts. The upper
  // bound is bcrypt's 72 bytes (see lib/password.ts).
  password: z.string().min(8, 'PASSWORD_TOO_SHORT').refine(fitsBcryptLimit, { message: 'PASSWORD_TOO_LONG' }),
  phone: z.string().max(20, 'PHONE_TOO_LONG').optional(),
});

type AuthT = Awaited<ReturnType<typeof getActionT<'auth'>>>;

function issueText(t: AuthT, issues: { message: string }[]) {
  return t.dynamic(`errors.${issues[0]?.message}`, undefined, t('errors.INVALID_INPUT'));
}

export async function login(prevState: unknown, formData: FormData) {
  const t = await getActionT('auth');
  const headersList = await headers();
  const ip = getClientIp(headersList);
  if (!(await loginLimiter.check(ip))) {
    return { error: t('errors.LOGIN_RATE_LIMITED') };
  }

  const result = loginSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    return { error: issueText(t, result.error.issues) };
  }

  const { password } = result.data;
  const email = result.data.email.trim().toLowerCase();

  // The per-IP bucket above cannot see guesses at one account spread across
  // many addresses; this one can. Checked before the lookup, for every
  // address alike, so it says nothing about which accounts exist. Anyone can
  // spend it, so a browser that has signed in to this account before skips it
  // (lib/login-device.ts) and the owner cannot be locked out by strangers.
  if (!(await isRecognisedLoginDevice(email)) && !(await loginAccountLimiter.check(accountRateLimitKey(email)))) {
    return { error: t('errors.LOGIN_RATE_LIMITED') };
  }

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || !user.password) {
    return { error: t('errors.INCORRECT_CREDENTIALS') };
  }

  const isValid = await verifyPassword(password, user.password);

  if (!isValid) {
    return { error: t('errors.INCORRECT_CREDENTIALS') };
  }

  const redirectTo = postSignInPath(t.locale, formData.get('redirect') as string, user.role);
  await appendAuditEvent({ actorUserId: user.id, action: 'AUTH.LOGIN', targetType: 'User', targetId: user.id, metadata: { method: 'password' } });
  await rememberLoginDevice(email);
  // Password is the only factor. The session is marked verified so nothing
  // downstream can refuse an admin for a second factor that is never asked for.
  await createSession(user.id, user.role, user.sessionVersion, true);
  redirect(redirectTo);
}

export async function register(prevState: unknown, formData: FormData) {
  const t = await getActionT('auth');
  const headersList = await headers();
  const ip = getClientIp(headersList);
  if (!(await registerLimiter.check(ip))) {
    return { error: t('errors.REGISTER_RATE_LIMITED') };
  }

  const result = registerSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    return { error: issueText(t, result.error.issues) };
  }

  const { password, name, phone } = result.data;
  const email = result.data.email.trim().toLowerCase();

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { password: true, oauthAccounts: { select: { provider: true } } },
  });

  const redirectTo = postSignInPath(t.locale, formData.get('redirect') as string);

  // Never merge registration input into an existing user. Legacy guests recover
  // access through the emailed password-reset proof, just like other accounts.
  const decision = decideRegistration(
    existingUser
      ? {
          hasPassword: Boolean(existingUser.password),
          linkedProviderCount: existingUser.oauthAccounts.length,
        }
      : null,
  );

  if (decision.kind === 'REJECT') {
    return { error: t(`errors.${decision.code}`) };
  }

  const hashedPassword = await hashPassword(password);

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        phone,
        role: 'USER',
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { error: t('errors.EMAIL_TAKEN') };
    }
    throw error;
  }

  await createSession(user.id, user.role, user.sessionVersion);
  redirect(redirectTo);
}

export async function logout() {
  await deleteSession();
  redirect(await localizedPath('/'));
}
