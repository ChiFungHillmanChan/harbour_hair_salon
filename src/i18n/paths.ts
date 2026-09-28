import { DEFAULT_LOCALE, LOCALE_PREFIX, LOCALE_SEGMENT, LOCALES, type Locale } from './config';

/**
 * Split a browser pathname into its language and the language-free business
 * path that every permission, redirect and active-link rule is written against.
 *
 *   /zh-hk/admin/services → { locale: 'zh-HK', path: '/admin/services' }
 *   /admin/services       → { locale: 'en-GB', path: '/admin/services' }
 *   /zh-hk                → { locale: 'zh-HK', path: '/' }
 */
export function splitLocalePath(pathname: string): { locale: Locale; path: string; prefixed: boolean } {
  for (const locale of LOCALES) {
    const prefix = LOCALE_PREFIX[locale];
    if (!prefix) continue;
    if (pathname === prefix || pathname === `${prefix}/`) return { locale, path: '/', prefixed: true };
    if (pathname.startsWith(`${prefix}/`)) return { locale, path: pathname.slice(prefix.length), prefixed: true };
  }
  // The internal English segment. It is never a public URL (middleware
  // redirects it), but on a rewritten English page `usePathname()` may report
  // the route it rendered — /en-gb/auth/signin — rather than /auth/signin.
  const internal = `/${LOCALE_SEGMENT[DEFAULT_LOCALE]}`;
  if (pathname === internal || pathname === `${internal}/`) return { locale: DEFAULT_LOCALE, path: '/', prefixed: false };
  if (pathname.startsWith(`${internal}/`)) return { locale: DEFAULT_LOCALE, path: pathname.slice(internal.length), prefixed: false };
  return { locale: DEFAULT_LOCALE, path: pathname || '/', prefixed: false };
}

/** The language-free path of a pathname (see splitLocalePath). */
export function stripLocale(pathname: string | null | undefined): string {
  return splitLocalePath(pathname ?? '/').path;
}

/**
 * Put an internal href into a language. Only site-absolute paths change:
 * external URLs, `mailto:`/`tel:`, bare `#anchors`, machine paths (/api, files)
 * and hrefs that already carry a language are returned untouched, so it is safe
 * to run over every href a component renders.
 */
export function localizeHref(locale: Locale, href: string): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  const pathEnd = href.search(/[?#]/);
  const path = pathEnd === -1 ? href : href.slice(0, pathEnd);
  const rest = pathEnd === -1 ? '' : href.slice(pathEnd);
  if (isMachinePath(path)) return href;
  const current = splitLocalePath(path);
  const prefix = LOCALE_PREFIX[locale];
  if (current.prefixed || current.path !== path) {
    // Already localized: re-home it (used by the language switcher).
    return `${prefix}${current.path === '/' && prefix ? '' : current.path}${rest}` || '/';
  }
  if (!prefix) return href;
  return `${prefix}${path === '/' ? '' : path}${rest}`;
}

/** Same page in another language, keeping the query string and #anchor. */
export function switchLocaleHref(locale: Locale, pathname: string, search = '', hash = ''): string {
  const { path } = splitLocalePath(pathname);
  const prefix = LOCALE_PREFIX[locale];
  const localized = prefix ? `${prefix}${path === '/' ? '' : path}` : path;
  const query = search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : '';
  const anchor = hash && hash !== '#' ? (hash.startsWith('#') ? hash : `#${hash}`) : '';
  return `${localized || '/'}${query}${anchor}`;
}

/**
 * Paths that are not pages and must keep one language-free address: API
 * routes (OAuth callback, cron, ICS feeds, health), Next internals and files
 * in /public (anything with an extension).
 */
export function isMachinePath(path: string): boolean {
  if (path === '/api' || path.startsWith('/api/')) return true;
  if (path.startsWith('/_next/') || path.startsWith('/_vercel/')) return true;
  if (path.startsWith('/.well-known/')) return true;
  const last = path.slice(path.lastIndexOf('/') + 1);
  return /\.[A-Za-z0-9]{1,16}$/.test(last);
}
