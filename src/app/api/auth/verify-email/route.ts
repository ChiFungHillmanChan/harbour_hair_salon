import { NextRequest, NextResponse } from 'next/server';
import { readEmailVerificationToken } from '@/app/lib/email-verification';
import { localizeHref } from '@/i18n/paths';
import { getRequestLocale } from '@/i18n/request';

export const runtime = 'nodejs';

/**
 * The address verification emails linked to before 2026-10-13 (newer emails
 * link straight to the confirm page). Opening it changes NOTHING: corporate
 * mail scanners fetch every link in a message, and when this GET recorded the
 * proof they confirmed addresses nobody had clicked. It only forwards to the
 * confirm page, in the language the link was sent in, where a button press
 * (confirmEmailVerification) does the work.
 *
 * No database work at all: a forged or expired link goes straight to the
 * "not valid" page, a genuine one to the button.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const claim = await readEmailVerificationToken(token);
  const locale = claim?.locale ?? await getRequestLocale();
  const target = claim
    ? `/auth/verify-email/confirm?token=${encodeURIComponent(token)}`
    : '/auth/verify-email?status=invalid';
  return NextResponse.redirect(new URL(localizeHref(locale, target), request.url));
}
