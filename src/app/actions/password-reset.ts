'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import prisma from '@/app/lib/prisma';
import { hashPassword } from '@/app/lib/password';
import { passwordResetLimiter } from '@/app/lib/rate-limit';
import { sendPasswordReset } from '@/app/services/email-service';
import {
  generateResetToken,
  hashResetToken,
  evaluateResetToken,
  RESET_TOKEN_TTL_MS,
  RESET_REQUESTED_MESSAGE,
  INVALID_RESET_LINK_MESSAGE,
} from '@/app/lib/password-reset';

export type RequestResetState =
  | { status: 'idle' }
  | { status: 'sent'; message: string }
  | { status: 'error'; message: string };

export type ResetPasswordState =
  | { status: 'idle' }
  | { status: 'success' }
  | { status: 'error'; message: string };

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.'),
});

const resetSchema = z
  .object({
    token: z.string().min(1).max(200),
    password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
    confirmPassword: z.string().max(128),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

function getClientIp(headersList: Headers): string {
  return headersList.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Step 1 — email a reset link.
 *
 * Always reports the same generic message regardless of whether the address
 * exists, so this form cannot be used to enumerate customer accounts.
 */
export async function requestPasswordReset(
  _prev: RequestResetState,
  formData: FormData,
): Promise<RequestResetState> {
  const ip = getClientIp(await headers());
  if (!(await passwordResetLimiter.check(ip))) {
    return { status: 'error', message: 'Too many requests. Please try again in an hour.' };
  }

  const parsed = requestSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0].message };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, name: true },
  });

  // No account: stop here, but return the same message as the success path.
  if (!user) return { status: 'sent', message: RESET_REQUESTED_MESSAGE };

  const token = generateResetToken();

  try {
    // Invalidate any outstanding links for this user before issuing a new one,
    // so only the most recent email works.
    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
      prisma.passwordResetToken.create({
        data: {
          tokenHash: hashResetToken(token),
          userId: user.id,
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      }),
    ]);

    await sendPasswordReset({ email: user.email, name: user.name }, token);
  } catch (error) {
    console.error('Password reset request failed:', error);
    return {
      status: 'error',
      message: 'We could not send the reset email. Please try again later.',
    };
  }

  return { status: 'sent', message: RESET_REQUESTED_MESSAGE };
}

/**
 * Step 2 — redeem a token and set the new password.
 *
 * Bumps sessionVersion so every session issued before the reset stops working
 * (matching admin.ts resetUserPassword), and marks the token used in the same
 * transaction so a link can never be redeemed twice.
 */
export async function resetPassword(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const ip = getClientIp(await headers());
  if (!(await passwordResetLimiter.check(`redeem:${ip}`))) {
    return { status: 'error', message: 'Too many attempts. Please try again in an hour.' };
  }

  const parsed = resetSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0].message };
  }

  // Look the token up by hash — the raw value is never stored.
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(parsed.data.token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record) {
    return { status: 'error', message: INVALID_RESET_LINK_MESSAGE };
  }

  const verdict = evaluateResetToken({ expiresAt: record.expiresAt, usedAt: record.usedAt });
  if (!verdict.ok) {
    return { status: 'error', message: INVALID_RESET_LINK_MESSAGE };
  }

  const hashedPassword = await hashPassword(parsed.data.password);

  try {
    await prisma.$transaction([
      // Conditional update: `usedAt: null` in the filter means two concurrent
      // redemptions of the same link cannot both succeed — the second matches
      // zero rows.
      prisma.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: record.userId },
        data: { password: hashedPassword, sessionVersion: { increment: 1 } },
      }),
      // Clear any other outstanding links for this account.
      prisma.passwordResetToken.deleteMany({
        where: { userId: record.userId, usedAt: null },
      }),
    ]);
  } catch (error) {
    console.error('Password reset failed:', error);
    return { status: 'error', message: 'Could not reset your password. Please try again.' };
  }

  return { status: 'success' };
}
