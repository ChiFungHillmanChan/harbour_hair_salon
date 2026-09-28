import type { Translate } from '@/i18n/translator';
import type { Messages } from '@/i18n/messages/types';

const KEY_LABELS: Record<string, string> = {
  home: 'faqs.keyLabels.home',
  contact: 'faqs.keyLabels.contact',
  'services-master': 'faqs.keyLabels.servicesMaster',
};

/** Human name of an FAQ page key ("home" → "Home page"); unknown keys show as typed. */
export function faqKeyLabel(key: string, t: Translate<Messages['adminContent']>): string {
  if (KEY_LABELS[key]) return t.dynamic(KEY_LABELS[key]);
  if (key.startsWith('category:')) return t('faqs.keyLabels.category', { slug: key.slice('category:'.length) });
  return key;
}
