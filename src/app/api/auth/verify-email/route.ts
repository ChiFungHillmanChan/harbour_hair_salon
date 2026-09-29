import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/app/lib/prisma';
import { appendAuditEvent } from '@/app/lib/audit';
import { readEmailVerificationToken } from '@/app/lib/email-verification';
import { localizeHref } from '@/i18n/paths';
import { getRequestLocale } from '@/i18n/request';

export const runtime = 'nodejs';

/**
 * The link in the verification email. Records that the account receives mail
 * at its address, then shows the result in the language the link was sent in.
 *
 * Only reached from that email (never polled), and a forged or expired link is
 * refused before any database work. Repeating a used link — as mail scanners
 * do — just confirms the same address again.
 */
export async function GET(request: NextRequest) {
  const claim = await readEmailVerificationToken(request.nextUrl.searchParams.get('token') ?? '');
  const locale = claim?.locale ?? await getRequestLocale();
  let status: 'verified' | 'invalid' = 'invalid';

  if (claim) {
    try {
      // The address must still be the one the link was sent to: a link for an
      // old address proves nothing about the current one.
      const confirmed = await prisma.user.updateMany({
        where: { id: claim.userId, email: claim.email, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
      if (confirmed.count === 1) {
        status = 'verified';
        await appendAuditEvent({ actorUserId: claim.userId, action: 'AUTH.EMAIL_VERIFIED', targetType: 'User', targetId: claim.userId });
      } else {
        const current = await prisma.user.findUnique({ where: { id: claim.userId }, select: { email: true, emailVerifiedAt: true } });
        if (current?.email === claim.email && current.emailVerifiedAt) status = 'verified';
      }
    } catch (error) {
      console.error('Email verification failed:', error);
    }
  }

  return NextResponse.redirect(new URL(localizeHref(locale, `/auth/verify-email?status=${status}`), request.url));
}
