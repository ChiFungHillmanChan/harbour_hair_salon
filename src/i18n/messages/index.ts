import type { Locale } from '../config';
import { createTranslator, type Translate } from '../translator';
import { en } from './en';
import { zh } from './zh';
import type { Localized, Messages, Namespace } from './types';

export type { Localized, Messages, Namespace } from './types';

/**
 * Server-side dictionary. Client components never import this module (it holds
 * every string of both languages); they receive a per-page subset through
 * <ClientMessages>.
 */
export const MESSAGES: Record<Locale, Localized<Messages>> = { 'en-GB': en, 'zh-HK': zh };

/** Synchronous translator for a known language — emails, actions, route handlers, tests. */
export function translator<N extends Namespace>(locale: Locale, namespace: N): Translate<Messages[N]> {
  return createTranslator(locale, MESSAGES[locale][namespace] as Messages[N], namespace);
}

export type ClientMessagesPayload = Partial<Localized<Messages>>;

export function pickMessages(locale: Locale, namespaces: readonly Namespace[]): ClientMessagesPayload {
  const picked: Record<string, unknown> = {};
  for (const namespace of namespaces) picked[namespace] = MESSAGES[locale][namespace];
  return picked as ClientMessagesPayload;
}

/**
 * Only some sections of a namespace, for a provider that every page carries
 * (the root layout). Server-only copy — metadata, footer — stays on the server.
 */
export function pickSections<N extends Namespace>(locale: Locale, namespace: N, sections: readonly (keyof Messages[N] & string)[]): ClientMessagesPayload {
  const tree = MESSAGES[locale][namespace] as Record<string, unknown>;
  return { [namespace]: Object.fromEntries(sections.map((section) => [section, tree[section]])) } as ClientMessagesPayload;
}
