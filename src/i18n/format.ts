import type { Locale } from './config';

/**
 * A plural message picks its form with Intl.PluralRules for the `count`
 * parameter. English needs `one` + `other`; Chinese has only `other`.
 */
export type PluralMessage = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };
export type MessageValue = string | PluralMessage;
export interface MessageTree { [key: string]: MessageValue | MessageTree }
export type MessageParams = Record<string, string | number | null | undefined>;

const PLURAL_KEYS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

export function isPluralMessage(value: unknown): value is PluralMessage {
  if (!value || typeof value !== 'object') return false;
  const keys = Object.keys(value);
  return typeof (value as PluralMessage).other === 'string' && keys.every((key) => PLURAL_KEYS.has(key));
}

const pluralRules = new Map<Locale, Intl.PluralRules>();
function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

/** Interpolate `{name}` placeholders. Unknown placeholders stay visible so a gap is noticed, never silently blank. */
export function interpolate(template: string, params: MessageParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

export function formatMessage(locale: Locale, value: MessageValue, params: MessageParams = {}): string {
  if (typeof value === 'string') return interpolate(value, params);
  const count = Number(params.count ?? 0);
  const category = pluralCategory(locale, count);
  const template = (count === 0 && value.zero) || value[category] || value.other;
  return interpolate(template, params);
}

/** Walk a dotted key ("step.title") through a message tree. */
export function lookup(tree: MessageTree | undefined, key: string): MessageValue | undefined {
  let node: MessageValue | MessageTree | undefined = tree;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object' || isPluralMessage(node)) return undefined;
    node = (node as MessageTree)[part];
  }
  if (typeof node === 'string' || isPluralMessage(node)) return node;
  return undefined;
}

/** Placeholder names used by a message (both plural forms included). */
export function placeholders(value: MessageValue): string[] {
  const texts = typeof value === 'string' ? [value] : Object.values(value).filter((v): v is string => typeof v === 'string');
  const names = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(/\{(\w+)\}/g)) names.add(match[1]);
  return [...names].sort();
}
