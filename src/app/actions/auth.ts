'use server';

import { z } from 'zod';
import prisma from '@/app/lib/prisma';
import { hashPassword, verifyPassword } from '@/app/lib/password';
import { createSession, deleteSession } from '@/app/lib/session';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

function sanitizeRedirect(url: string | null): string {
  if (!url) return '/';
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return '/';
}

function getClientIp(headersList: Headers): string {
  const forwarded = headersList.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

// Persistent rate limiter — survives serverless cold starts
// Falls back to in-memory if Upstash is not configured
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

const loginLimiter = upstashUrl && upstashToken
  ? new Ratelimit({
      redis: new Redis({ url: upstashUrl, token: upstashToken }),
      limiter: Ratelimit.slidingWindow(5, '15 m'),
      prefix: 'rl:login',
    })
  : null;

const registerLimiter = upstashUrl && upstashToken
  ? new Ratelimit({
      redis: new Redis({ url: upstashUrl, token: upstashToken }),
      limiter: Ratelimit.slidingWindow(5, '15 m'),
      prefix: 'rl:register',
    })
  : null;

// In-memory fallback (separate maps for login vs register)
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();
const registerAttempts = new Map<string, { count: number; firstAttempt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function checkMemoryRateLimit(map: Map<string, { count: number; firstAttempt: number }>, ip: string): boolean {
  const now = Date.now();
  const record = map.get(ip);
  if (!record || now - record.firstAttempt > WINDOW_MS) {
    map.set(ip, { count: 1, firstAttempt: now });
    return true;
  }
  record.count++;
  return record.count <= MAX_ATTEMPTS;
}

async function checkLoginRate(ip: string): Promise<boolean> {
  if (loginLimiter) {
    try {
      const { success } = await loginLimiter.limit(ip);
      return success;
    } catch (err) {
      // Redis outage must not take down login entirely — fail open, but log it.
      console.error('Login rate limiter unavailable, allowing request:', err);
      return true;
    }
  }
  return checkMemoryRateLimit(loginAttempts, ip);
}

async function checkRegisterRate(ip: string): Promise<boolean> {
  if (registerLimiter) {
    try {
      const { success } = await registerLimiter.limit(ip);
      return success;
    } catch (err) {
      console.error('Register rate limiter unavailable, allowing request:', err);
      return true;
    }
  }
  return checkMemoryRateLimit(registerAttempts, ip);
}

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address.').max(254),
  password: z.string().min(1, 'Password is required.').max(128),
});

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters.').max(100),
  email: z.string().email('Please enter a valid email address.').max(254),
  password: z.string().min(6, 'Password must be at least 6 characters.').max(128),
  phone: z.string().max(20).optional(),
});

export async function login(prevState: unknown, formData: FormData) {
  const headersList = await headers();
  const ip = getClientIp(headersList);
  if (!(await checkLoginRate(ip))) {
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
    return { error: 'Incorrect email or password. Please try again.' };
  }

  const isValid = await verifyPassword(password, user.password);

  if (!isValid) {
    return { error: 'Incorrect email or password. Please try again.' };
  }

  await createSession(user.id, user.role);

  const redirectTo = sanitizeRedirect(formData.get('redirect') as string);
  if (user.role === 'ADMIN') {
    redirect('/admin');
  } else {
    redirect(redirectTo);
  }
}

export async function register(prevState: unknown, formData: FormData) {
  const headersList = await headers();
  const ip = getClientIp(headersList);
  if (!(await checkRegisterRate(ip))) {
    return { error: 'Too many registration attempts. Please try again in 15 minutes.' };
  }

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
