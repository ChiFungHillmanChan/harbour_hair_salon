'use server';

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '@/app/lib/prisma';
import { hashPassword, verifyPassword } from '@/app/lib/password';
import { createSession, deleteSession } from '@/app/lib/session';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { loginLimiter, registerLimiter } from '@/app/lib/rate-limit';
import { sanitizeRedirect } from '@/app/lib/redirect';
import { decideRegistration } from '@/app/lib/register-gate';
import { appendAuditEvent } from '@/app/lib/audit';

function getClientIp(headersList: Headers): string {
  const forwarded = headersList.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

// Rate limiting (Redis-backed, with an in-process fallback) lives in
// lib/rate-limit.ts so an unset UPSTASH_* env degrades the limit instead of
// removing it.

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address.').max(254),
  password: z.string().min(1, 'Password is required.').max(128),
});

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters.').max(100),
  email: z.string().email('Please enter a valid email address.').max(254),
  // 8 minimum, matching the admin-user schema in actions/admin.ts.
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  phone: z.string().max(20).optional(),
});

export async function login(prevState: unknown, formData: FormData) {
  const headersList = await headers();
  const ip = getClientIp(headersList);
  if (!(await loginLimiter.check(ip))) {
    return { error: 'Too many login attempts. Please try again in 15 minutes.' };
  }

  const result = loginSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    return { error: result.error.issues[0].message };
  }

  const { password } = result.data;
  const email = result.data.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || !user.password) {
    return { error: 'Incorrect email or password. Please try again.' };
  }

  const isValid = await verifyPassword(password, user.password);

  if (!isValid) {
    return { error: 'Incorrect email or password. Please try again.' };
  }

  const redirectTo = sanitizeRedirect(formData.get('redirect') as string);
  await appendAuditEvent({ actorUserId: user.id, action: 'AUTH.LOGIN', targetType: 'User', targetId: user.id, metadata: { method: 'password' } });
  // Password is the only factor. The session is marked verified so nothing
  // downstream can refuse an admin for a second factor that is never asked for.
  await createSession(user.id, user.role, user.sessionVersion, true);
  redirect(user.role === 'ADMIN' ? '/admin' : redirectTo);
}

export async function register(prevState: unknown, formData: FormData) {
  const headersList = await headers();
  const ip = getClientIp(headersList);
  if (!(await registerLimiter.check(ip))) {
    return { error: 'Too many registration attempts. Please try again in 15 minutes.' };
  }

  const result = registerSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    return { error: result.error.issues[0].message };
  }

  const { password, name, phone } = result.data;
  const email = result.data.email.trim().toLowerCase();

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { password: true, oauthAccounts: { select: { provider: true } } },
  });

  const redirectTo = sanitizeRedirect(formData.get('redirect') as string);

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
    return { error: decision.error };
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
      return { error: 'This email is already registered. Please sign in instead.' };
    }
    throw error;
  }

  await createSession(user.id, user.role, user.sessionVersion);
  redirect(redirectTo);
}

export async function logout() {
  await deleteSession();
  redirect('/');
}
