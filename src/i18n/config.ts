/**
 * Site languages. English keeps every existing URL; Traditional Chinese (Hong
 * Kong) lives under /zh-hk. Internally both are routed through the
 * `app/[locale]` root segment — middleware rewrites an unprefixed URL to
 * `/en-gb/...`, so the `en-gb` segment never appears in a public URL.
 *
 * Pure module: imported by middleware, server code and client components.
 */
export const LOCALES = ['en-GB', 'zh-HK'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en-GB';

/** The `[locale]` route segment for each language. */
export const LOCALE_SEGMENT: Record<Locale, string> = { 'en-GB': 'en-gb', 'zh-HK': 'zh-hk' };

/** Public URL prefix. English has none so existing links, SEO and emails keep working. */
export const LOCALE_PREFIX: Record<Locale, string> = { 'en-GB': '', 'zh-HK': '/zh-hk' };

/** Value for `<html lang>`, hreflang and Intl formatting. */
export const HTML_LANG: Record<Locale, string> = { 'en-GB': 'en-GB', 'zh-HK': 'zh-HK' };

/** Open Graph `og:locale`. */
export const OG_LOCALE: Record<Locale, string> = { 'en-GB': 'en_GB', 'zh-HK': 'zh_HK' };

/** Each language is named in itself, so a visitor who cannot read the page can still find theirs. */
export const LOCALE_LABEL: Record<Locale, string> = { 'en-GB': 'English', 'zh-HK': '繁體中文' };

/**
 * Remembers a MANUAL language choice. It never redirects an explicit URL; it
 * only supplies a language where a request carries none (the Google OAuth
 * callback, which lives under /api).
 */
export const LOCALE_COOKIE = 'hh_locale';

/**
 * Middleware stamps the validated language of every page request (including
 * Server Action POSTs, which go to the page URL) on this request header, because
 * `next/root-params` is not available inside Server Actions or Route Handlers.
 * Middleware always overwrites any client-sent value.
 */
export const LOCALE_HEADER = 'x-harbour-locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function localeFromSegment(segment: string | null | undefined): Locale | null {
  for (const locale of LOCALES) if (LOCALE_SEGMENT[locale] === segment) return locale;
  return null;
}

/** Accepts `zh-HK`, `zh-hk` or a stored preference; anything else is null. */
export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  if (isLocale(value)) return value;
  return localeFromSegment(value.toLowerCase());
}

/** Old records carry no language; they were all written in English. */
export function localeOrDefault(value: string | null | undefined): Locale {
  return normalizeLocale(value) ?? DEFAULT_LOCALE;
}
