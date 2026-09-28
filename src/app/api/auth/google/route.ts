import { NextRequest, NextResponse } from 'next/server';
import {
  createGoogleAuthorization,
  getGoogleOAuthStateCookieOptions,
  GOOGLE_OAUTH_STATE_COOKIE,
} from '@/app/lib/google-oauth';
import { normalizeLocale } from '@/i18n/config';
import { localizeHref } from '@/i18n/paths';
import { getRequestLocale } from '@/i18n/request';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // The sign-in button sends its page's language; without one, fall back to
  // the remembered manual choice, then English.
  const locale = normalizeLocale(request.nextUrl.searchParams.get('locale')) ?? await getRequestLocale();
  try {
    const { authorizationUrl, stateCookie } = await createGoogleAuthorization(
      request.nextUrl.origin,
      request.nextUrl.searchParams.get('redirect'),
      locale
    );
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, stateCookie, getGoogleOAuthStateCookieOptions());
    return response;
  } catch (error) {
    console.error('Starting Google OAuth failed:', error);
    return NextResponse.redirect(new URL(localizeHref(locale, '/auth/signin?error=google_unavailable'), request.url));
  }
}
