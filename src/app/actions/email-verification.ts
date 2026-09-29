'use server';

import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { createRateLimiter } from '@/app/lib/rate-limit';
import { EMAIL_VERIFICATION_SELECT, hasVerifiedEmail } from '@/app/lib/email-verification';
import { sendEmailVerification } from '@/app/services/email-service';
import { getActionT } from '@/i18n/request';

// 'sent' and 'verified' carry no text: the page words them in its own language.
export type ResendVerificationState =
  | { status: 'idle' }
  | { status: 'sent' }
  | { status: 'verified' }
  | { status: 'error'; message: string };

// Each request emails the account's own address; a few an hour is plenty for a
// person and stops the button being used to flood a mailbox.
const resendLimiter = createRateLimiter({ prefix: 'rl:verify-email', limit: 3, windowSeconds: 60 * 60 });

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

  if (!(await resendLimiter.check(`user:${user.id}`))) {
    return { status: 'error', message: t('verifyEmail.RATE_LIMITED') };
  }

  try {
    await sendEmailVerification(user, t.locale);
  } catch (error) {
    console.error('Verification email failed:', error);
    return { status: 'error', message: t('verifyEmail.SEND_FAILED') };
  }
  return { status: 'sent' };
}
