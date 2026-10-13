'use server';

import { headers } from 'next/headers';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { createRateLimiter, emailSendDailyLimiter } from '@/app/lib/rate-limit';
import { EMAIL_VERIFICATION_SELECT, hasVerifiedEmail } from '@/app/lib/email-verification';
import { sendEmailVerification } from '@/app/services/email-service';
import { getActionT } from '@/i18n/request';

// 'sent' and 'verified' carry no text: the page words them in its own language.
export type ResendVerificationState =
  | { status: 'idle' }
  | { status: 'sent' }
  | { status: 'verified' }
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
