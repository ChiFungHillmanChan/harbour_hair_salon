import type { ReactNode } from 'react';
import { I18nProvider } from './client';
import { pickMessages, pickSections, type ClientMessagesPayload, type Namespace } from './messages';
import { getLocale } from './server';

/**
 * Server Component: hands the listed namespaces — or only some sections of a
 * namespace — in the page's language to the client components below it.
 * Only these strings reach the browser.
 */
export async function ClientMessages({ namespaces = [], sections = {}, children }: {
  namespaces?: readonly Namespace[];
  sections?: Partial<Record<Namespace, readonly string[]>>;
  children: ReactNode;
}) {
  const locale = await getLocale();
  const messages: ClientMessagesPayload = { ...pickMessages(locale, namespaces) };
  for (const [namespace, keys] of Object.entries(sections) as [Namespace, readonly string[]][]) {
    Object.assign(messages, pickSections(locale, namespace, keys as never));
  }
  return <I18nProvider locale={locale} messages={messages}>{children}</I18nProvider>;
}
