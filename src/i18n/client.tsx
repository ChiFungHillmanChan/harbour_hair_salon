'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_LOCALE, type Locale } from './config';
import { localizeHref } from './paths';
import { createTranslator, type Translate } from './translator';
import type { ClientMessagesPayload, Messages, Namespace } from './messages/types-client';

type I18nContextValue = { locale: Locale; messages: ClientMessagesPayload };

const I18nContext = createContext<I18nContextValue>({ locale: DEFAULT_LOCALE, messages: {} });

/**
 * Supplies the page language and the dictionary namespaces its client
 * components need. Nested providers add namespaces; they never drop the
 * outer ones.
 */
export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: ClientMessagesPayload; children: ReactNode }) {
  const parent = useContext(I18nContext);
  const value = useMemo<I18nContextValue>(
    () => ({ locale, messages: parent.locale === locale ? { ...parent.messages, ...messages } : messages }),
    [locale, messages, parent],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

export function useT<N extends Namespace>(namespace: N): Translate<Messages[N]> {
  const { locale, messages } = useContext(I18nContext);
  const tree = messages[namespace] as Messages[N] | undefined;
  return useMemo(() => createTranslator(locale, tree, namespace), [locale, tree, namespace]);
}

/** Localize internal hrefs built at runtime (router.push, window.location). */
export function useLocalizeHref(): (href: string) => string {
  const locale = useLocale();
  return useMemo(() => (href: string) => localizeHref(locale, href), [locale]);
}
