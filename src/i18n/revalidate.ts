import { LOCALE_SEGMENT, LOCALES } from './config';

type Revalidate = (path: string, type?: 'page' | 'layout') => void;

/** Internal route paths of a public page in every language. */
export function localizedRoutePaths(path: string): string[] {
  return LOCALES.map((locale) => {
    const segment = `/${LOCALE_SEGMENT[locale]}`;
    return path === '/' ? segment : `${segment}${path}`;
  });
}

/**
 * Every page exists once per language under the `[locale]` segment
 * (/en-gb/services and /zh-hk/services), so a change must drop both. Pass
 * next/cache's `revalidatePath` — taking it as an argument keeps this module
 * free of framework imports, so actions stay testable with a mocked cache.
 * Takes the public, language-free path ("/services", "/blog/my-post").
 */
export function revalidateAllLocales(revalidate: Revalidate, path: string, type?: 'page' | 'layout') {
  for (const internal of localizedRoutePaths(path)) revalidate(internal, type);
}
