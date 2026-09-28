import 'server-only';
import { locale as localeRootParam } from 'next/root-params';
import { DEFAULT_LOCALE, localeFromSegment, type Locale } from './config';
import { translator, type Namespace } from './messages';

/**
 * Language of the page being rendered, from the `[locale]` root segment.
 * Server Components only (layouts, pages, their server children) — Server
 * Actions, route handlers and shared server utilities use ./request instead.
 */
export async function getLocale(): Promise<Locale> {
  return localeFromSegment(await localeRootParam()) ?? DEFAULT_LOCALE;
}

/** `t` for a namespace in the page's language (Server Components). */
export async function getT<N extends Namespace>(namespace: N) {
  return translator(await getLocale(), namespace);
}

export { getActionLocale, getActionT, getRequestLocale, localizedPath } from './request';
