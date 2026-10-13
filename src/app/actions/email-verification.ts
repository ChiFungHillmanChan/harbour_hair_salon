'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { appendAuditEvent } from '@/app/lib/audit';
import { createRateLimiter, emailSendDailyLimiter } from '@/app/lib/rate-limit';
import {
  EMAIL_VERIFICATION_SELECT,
  hasVerifiedEmail,
  readEmailVerificationToken,
  type EmailVerificationClaim,
} from '@/app/lib/email-verification';
import { sendEmailVerification } from '@/app/services/email-service';
import { getActionT, localizedPath } from '@/i18n/request';

// 'sent' and 'verified' carry no text: the page words them in its own language.
export type ResendVerificationState =
  | { status: 'idle' }
  | { status: 'sent' }
  | { status: 'verified' }
  | { status: 'error'; message: string };

/** Success leaves the page (a redirect to the outcome); only a problem comes back. */
export type ConfirmEmailState =
  | { status: 'idle' }
  | { status: 'error'; message: string };

function getClientIp(headersList: Headers): string {
  return headersList.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

// Each request emails the account's own address; a few an hour is plenty for a
// person and stops the button being used to flood a mailbox.
const resendLimiter = createRateLimiter({ prefix: 'rl:verify-email', limit: 3, windowSeconds: 60 * 60 });
// Per account alone, a client holding many accounts could keep sending: the
// same button is also limited per client address.
const resendIpLimiter = createRateLimiter({ prefix: 'rl:verify-email-ip', limit: 5, windowSeconds: 60 * 60 });

/**
 * Email the signed-in customer a fresh link confirming their address. Takes no
 * input: the account is the session's, so the form is just a button.
 */
export async function resendVerificationEmail(): Promise<ResendVerificationState> {
  const session = await verifySession();
  const t = await getActionT('auth');

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, ...EMAIL_VERIFICATION_SELECT },
  });
  if (!user) return { status: 'error', message: t('verifyEmail.SEND_FAILED') };
  if (hasVerifiedEmail(user)) return { status: 'verified' };

  const ip = getClientIp(await headers());
  if (!(await resendIpLimiter.check(ip)) || !(await resendLimiter.check(`user:${user.id}`))) {
    return { status: 'error', message: t('verifyEmail.RATE_LIMITED') };
  }
  // Last, so the client's daily email budget (shared with registration and
  // reset requests) is spent only on an email that is actually sent.
  if (!(await emailSendDailyLimiter.check(ip))) {
    return { status: 'error', message: t('errors.EMAIL_DAILY_LIMIT') };
  }

  try {
    await sendEmailVerification(user, t.locale);
  } catch (error) {
    console.error('Verification email failed:', error);
    return { status: 'error', message: t('verifyEmail.SEND_FAILED') };
  }
  return { status: 'sent' };
}

// The button on the confirm page. Nobody needs more than a couple of presses.
const confirmLimiter = createRateLimiter({ prefix: 'rl:verify-email-confirm', limit: 10, windowSeconds: 60 * 60 });

/**
 * Record what a genuine link proves. The proof and its audit entry are written
 * together, once: a link used again (or a second tab) finds the address
 * already confirmed and writes nothing.
 */
async function recordEmailVerification(claim: EmailVerificationClaim): Promise<'verified' | 'invalid'> {
  const first = await prisma.$transaction(async (tx) => {
    // The address must still be the one the link was sent to: a link for an
    // old address proves nothing about the current one.
    const confirmed = await tx.user.updateMany({
      where: { id: claim.userId, email: claim.email, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
    if (confirmed.count !== 1) return false;
    await appendAuditEvent({ actorUserId: claim.userId, action: 'AUTH.EMAIL_VERIFIED', targetType: 'User', targetId: claim.userId }, tx);
    return true;
  });
  if (first) return 'verified';
  const current = await prisma.user.findUnique({ where: { id: claim.userId }, select: { email: true, emailVerifiedAt: true } });
  return current?.email === claim.email && current.emailVerifiedAt ? 'verified' : 'invalid';
}

/**
 * The confirm page's "Confirm my email" button — the only place an emailed
 * verification link takes effect. A form POST rather than the link itself, so
 * a mail scanner that opens links confirms nothing (see the GET at
 * /api/auth/verify-email). Ends on the existing outcome page, in the language
 * of the page the button was pressed on.
 */
export async function confirmEmailVerification(_prev: ConfirmEmailState, formData: FormData): Promise<ConfirmEmailState> {
  const t = await getActionT('auth');
  if (!(await confirmLimiter.check(getClientIp(await headers())))) {
    return { status: 'error', message: t('verifyEmail.RATE_LIMITED') };
  }

  // Forged, altered or expired (48 h): refused before any database work.
  const token = formData.get('token');
  const claim = typeof token === 'string' ? await readEmailVerificationToken(token) : null;
  let status: 'verified' | 'invalid' = 'invalid';
  if (claim) {
    try {
      status = await recordEmailVerification(claim);
    } catch (error) {
      // Not the link's fault: let the customer press again.
      console.error('Email verification failed:', error);
      return { status: 'error', message: t('verifyEmail.CONFIRM_FAILED') };
    }
  }
  redirect(await localizedPath(`/auth/verify-email?status=${status}`));
}
