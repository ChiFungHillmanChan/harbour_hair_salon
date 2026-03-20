'use server';

import { z } from 'zod';
import prisma from '@/app/lib/prisma';
import { hashPassword, verifyPassword } from '@/app/lib/password';
import { createSession, deleteSession } from '@/app/lib/session';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

function sanitizeRedirect(url: string | null): string {
  if (!url) return '/';
  // Only allow relative paths starting with / and not protocol-relative //
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return '/';
}

const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function getClientIp(headersList: Headers): string {
  const forwarded = headersList.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now - record.firstAttempt > WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return true;
  }
  record.count++;
  return record.count <= MAX_ATTEMPTS;
}

function resetRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters.'),
  email: z.string().email('Please enter a valid email address.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  phone: z.string().optional(),
});

export async function login(prevState: unknown, formData: FormData) {
  const headersList = await headers();
  const ip = getClientIp(headersList);
  if (!checkRateLimit(ip)) {
    return { error: 'Too many login attempts. Please try again in 15 minutes.' };
  }

  const result = loginSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    return { error: result.error.issues[0].message };
  }

  const { email, password } = result.data;

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || !user.password) {
    // User doesn't exist or is a guest (no password)
    return { error: 'Incorrect email or password. Please try again.' };
  }

  const isValid = await verifyPassword(password, user.password);

  if (!isValid) {
    return { error: 'Incorrect email or password. Please try again.' };
  }

  await createSession(user.id, user.role);
  resetRateLimit(ip);

  const redirectTo = sanitizeRedirect(formData.get('redirect') as string);
  if (user.role === 'ADMIN') {
    redirect('/admin');
  } else {
    redirect(redirectTo);
  }
}

export async function register(prevState: unknown, formData: FormData) {
  const result = registerSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    return { error: result.error.issues[0].message };
  }

  const { email, password, name, phone } = result.data;

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  const redirectTo = sanitizeRedirect(formData.get('redirect') as string);

  if (existingUser) {
    if (existingUser.password) {
      return { error: 'This email is already registered. Please sign in instead.' };
    } else {
      // Guest user registering
      const hashedPassword = await hashPassword(password);
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          password: hashedPassword,
          name,
          phone,
        },
      });
      await createSession(existingUser.id, existingUser.role);
      redirect(redirectTo);
    }
  }

  const hashedPassword = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      phone,
      role: 'USER',
    },
  });

  await createSession(user.id, user.role);
  redirect(redirectTo);
}

export async function logout() {
  await deleteSession();
  redirect('/');
}
