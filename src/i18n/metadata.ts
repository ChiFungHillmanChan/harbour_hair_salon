import type { Metadata } from 'next';
import { DEFAULT_LOCALE, HTML_LANG, LOCALES, OG_LOCALE, type Locale } from './config';
import { localizeHref } from './paths';

/**
 * canonical + hreflang for a page that exists in both languages. Each language
 * is canonical to ITSELF (never all pointing back at English); `x-default` is
 * the English URL, which is what an unprefixed link has always served.
 */
export function alternatesFor(locale: Locale, path: string): NonNullable<Metadata['alternates']> {
  const languages: Record<string, string> = {};
  for (const option of LOCALES) languages[HTML_LANG[option]] = localizeHref(option, path);
  languages['x-default'] = localizeHref(DEFAULT_LOCALE, path);
  return { canonical: localizeHref(locale, path), languages };
}

/** Open Graph locale fields for a page in `locale`. */
export function ogLocale(locale: Locale) {
  return { locale: OG_LOCALE[locale], alternateLocale: LOCALES.filter((other) => other !== locale).map((other) => OG_LOCALE[other]) };
}
