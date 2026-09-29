'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import prisma from '@/app/lib/prisma';
import { fitsBcryptLimit, hashPassword } from '@/app/lib/password';
import { accountRateLimitKey, passwordResetAccountLimiter, passwordResetLimiter } from '@/app/lib/rate-limit';
import { sendPasswordReset } from '@/app/services/email-service';
import { appendAuditEvent } from '@/app/lib/audit';
import {
  generateResetToken,
  hashResetToken,
  evaluateResetToken,
  RESET_TOKEN_TTL_MS,
} from '@/app/lib/password-reset';
import { getActionT } from '@/i18n/request';

// 'sent' carries no text: the page words it in its own language, so the
// confirmation still reads correctly after a language switch.
export type RequestResetState =
  | { status: 'idle' }
  | { status: 'sent' }
  | { status: 'error'; message: string };

export type ResetPasswordState =
  | { status: 'idle' }
  | { status: 'success' }
  | { status: 'error'; message: string };

// Messages are codes, translated into the caller's language (auth.errors).
const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email('EMAIL_INVALID'),
});

const resetSchema = z
  .object({
    token: z.string().min(1, 'INVALID_RESET_LINK').max(200, 'INVALID_RESET_LINK'),
    password: z.string().min(8, 'PASSWORD_TOO_SHORT').refine(fitsBcryptLimit, { message: 'PASSWORD_TOO_LONG' }),
    confirmPassword: z.string().max(128, 'PASSWORD_TOO_LONG'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'PASSWORDS_DIFFER',
    path: ['confirmPassword'],
  });

type AuthT = Awaited<ReturnType<typeof getActionT<'auth'>>>;

function issueText(t: AuthT, issues: { message: string }[]) {
  return t.dynamic(`errors.${issues[0]?.message}`, undefined, t('errors.INVALID_INPUT'));
}

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
  const t = await getActionT('auth');
  const ip = getClientIp(await headers());
  if (!(await passwordResetLimiter.check(ip))) {
    return { status: 'error', message: t('errors.RESET_RATE_LIMITED') };
  }

  const parsed = requestSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { status: 'error', message: issueText(t, parsed.error.issues) };
  }

  // Each request emails the account and retires its previous link, so the
  // per-IP bucket alone let requests from many addresses flood one mailbox and
  // keep breaking its owner's link. Past the per-account budget, answer exactly
  // as if a link was sent (for every address alike) and send nothing: the
  // newest link already in the inbox still works.
  if (!(await passwordResetAccountLimiter.check(accountRateLimitKey(parsed.data.email)))) {
    return { status: 'sent' };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, name: true },
  });

  // No account: stop here, but return the same message as the success path.
  if (!user) return { status: 'sent' };

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

    // In the language of the page that asked for it.
    await sendPasswordReset({ email: user.email, name: user.name }, token, t.locale);
  } catch (error) {
    console.error('Password reset request failed:', error);
    return { status: 'error', message: t('errors.RESET_SEND_FAILED') };
  }

  return { status: 'sent' };
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
  const t = await getActionT('auth');
  const ip = getClientIp(await headers());
  if (!(await passwordResetLimiter.check(`redeem:${ip}`))) {
    return { status: 'error', message: t('errors.RESET_REDEEM_RATE_LIMITED') };
  }

  const parsed = resetSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    return { status: 'error', message: issueText(t, parsed.error.issues) };
  }

  // Look the token up by hash — the raw value is never stored.
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(parsed.data.token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record) {
    return { status: 'error', message: t('errors.INVALID_RESET_LINK') };
  }

  const verdict = evaluateResetToken({ expiresAt: record.expiresAt, usedAt: record.usedAt });
  if (!verdict.ok) {
    return { status: 'error', message: t('errors.INVALID_RESET_LINK') };
  }

  const hashedPassword = await hashPassword(parsed.data.password);

  try {
    const redeemed = await prisma.$transaction(async (tx) => {
      // Claim the still-live token before changing the password. An array
      // transaction cannot branch on count=0, so it would also change the
      // password for a concurrent request that lost this single-use claim.
      const now = new Date();
      const claim = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claim.count !== 1) return false;

      await tx.user.update({
        where: { id: record.userId },
        // Redeeming a link sent to the address proves the account receives
        // mail there, which is what booking asks for (lib/email-verification.ts).
        data: { password: hashedPassword, sessionVersion: { increment: 1 }, emailVerifiedAt: now },
      });
      await appendAuditEvent({ actorUserId: record.userId, action: 'AUTH.PASSWORD_RESET', targetType: 'User', targetId: record.userId }, tx);
      // Clear any other outstanding links for this account.
      await tx.passwordResetToken.deleteMany({
        where: { userId: record.userId, usedAt: null },
      });
      return true;
    });
    if (!redeemed) return { status: 'error', message: t('errors.INVALID_RESET_LINK') };
  } catch (error) {
    console.error('Password reset failed:', error);
    return { status: 'error', message: t('errors.RESET_FAILED') };
  }

  return { status: 'success' };
}
