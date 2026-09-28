import type { Locale } from './config';
import { formatMessage, lookup, type MessageParams, type MessageTree, type PluralMessage } from './format';

/** Dotted paths to every message in a tree, for typo-proof keys. */
export type MessageKey<T> = {
  [K in keyof T & string]: T[K] extends string | PluralMessage
    ? K
    : T[K] extends object
      ? `${K}.${MessageKey<T[K]>}`
      : never;
}[keyof T & string];

export type Translate<T> = ((key: MessageKey<T>, params?: MessageParams) => string) & {
  /** For keys chosen at runtime (status codes, error codes). Falls back to `fallback` or the key. */
  dynamic: (key: string, params?: MessageParams, fallback?: string) => string;
  has: (key: string) => boolean;
  locale: Locale;
};

/**
 * Build `t` for one namespace. A missing key renders as the key itself (and
 * warns in development) so a gap is visible on the page rather than blank.
 */
export function createTranslator<T extends MessageTree>(locale: Locale, tree: T | undefined, namespace: string): Translate<T> {
  const resolve = (key: string, params?: MessageParams, fallback?: string) => {
    const value = lookup(tree, key);
    if (value === undefined) {
      if (process.env.NODE_ENV !== 'production' && fallback === undefined) {
        console.warn(`[i18n] missing message ${locale}:${namespace}.${key}`);
      }
      return fallback ?? `${namespace}.${key}`;
    }
    return formatMessage(locale, value, params);
  };
  const t = ((key: string, params?: MessageParams) => resolve(key, params)) as unknown as Translate<T>;
  t.dynamic = (key, params, fallback) => resolve(key, params, fallback);
  t.has = (key) => lookup(tree, key) !== undefined;
  t.locale = locale;
  return t;
}
