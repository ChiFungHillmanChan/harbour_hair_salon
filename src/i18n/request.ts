import 'server-only';
import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, normalizeLocale, type Locale } from './config';
import { localizeHref } from './paths';
import { translator, type Namespace } from './messages';

/**
 * Language of the current request, for Server Actions and for dynamic server
 * code that cannot use root params (session redirects, route helpers).
 * Middleware validates the URL prefix and overwrites this header on every page
 * request, so a client cannot choose an arbitrary value; it only ever selects
 * between our two dictionaries and never affects authorisation. Reading it
 * makes a Server Component dynamic — use getLocale() from ./server in static
 * pages. Outside a request (unit tests, scripts) it is English.
 */
export async function getActionLocale(): Promise<Locale> {
  try {
    return normalizeLocale((await headers()).get(LOCALE_HEADER)) ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export async function getActionT<N extends Namespace>(namespace: N) {
  return translator(await getActionLocale(), namespace);
}

/**
 * Route handlers (e.g. the Google OAuth callback under /api) have no page URL
 * to read a language from, so they fall back to the remembered manual choice.
 */
export async function getRequestLocale(): Promise<Locale> {
  try {
    return normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value) ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * A language-free path in the current request's language, for redirect():
 *   redirect(await localizedPath('/auth/signin'))
 * Each module keeps calling its own `redirect` from next/navigation, so tests
 * that replace next/navigation keep working.
 */
export async function localizedPath(path: string): Promise<string> {
  return localizeHref(await getActionLocale(), path);
}
