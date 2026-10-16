import { NextResponse, type NextRequest } from 'next/server';
import { endAllSessions } from '@/app/lib/session';
import { clearAdminMfaChallenge } from '@/app/lib/admin-mfa';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@/i18n/config';
import { localizeHref } from '@/i18n/paths';

export const dynamic = 'force-dynamic';

/**
 * Wipes this site's HTTP cache (signed-in pages included) and its browser
 * storage. Cookies are deliberately not on the list: that would also drop the
 * language choice, the salon kiosk's device credential and the login_device
 * cookie that stops strangers locking the owner out. The account's own cookies
 * are removed one by one instead.
 */
export const SIGN_OUT_CLEAR_SITE_DATA = '"cache", "storage"';

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Sign-out is a plain form POST rather than a Server Action: only a real
 * response can carry Clear-Site-Data, and the full-page navigation it causes
 * throws away the client router cache, so Back cannot show a signed-in page.
 * There is no GET: a link scanner or prefetch must never sign anyone out.
 */
export async function POST(request: NextRequest) {
  // Another site may not sign this browser out (browsers without the header
  // send no session cookie on a cross-site POST anyway: it is SameSite=Lax).
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin') {
    return new NextResponse(null, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }

  const form = await request.formData().catch(() => null);
  const requested = form?.get('locale');
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;

  await endAllSessions();
  await clearAdminMfaChallenge();

  const response = NextResponse.redirect(new URL(localizeHref(locale, '/'), request.url), 303);
  response.headers.set('Clear-Site-Data', SIGN_OUT_CLEAR_SITE_DATA);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
