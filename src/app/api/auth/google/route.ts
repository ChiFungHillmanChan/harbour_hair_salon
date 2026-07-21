import { NextRequest, NextResponse } from 'next/server';
import {
  createGoogleAuthorization,
  getGoogleOAuthStateCookieOptions,
  GOOGLE_OAUTH_STATE_COOKIE,
} from '@/app/lib/google-oauth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { authorizationUrl, stateCookie } = await createGoogleAuthorization(
      request.nextUrl.origin,
      request.nextUrl.searchParams.get('redirect')
    );
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, stateCookie, getGoogleOAuthStateCookieOptions());
    return response;
  } catch (error) {
    console.error('Starting Google OAuth failed:', error);
    return NextResponse.redirect(new URL('/auth/signin?error=google_unavailable', request.url));
  }
}
