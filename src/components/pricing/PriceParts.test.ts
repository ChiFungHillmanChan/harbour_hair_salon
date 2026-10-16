import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

type Element = { type: unknown; props: Record<string, unknown> };
function text(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(text).join('');
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  return text((node as Element).props.children);
}

function load(locale: Locale) {
  return loadServerModule<typeof import('./PriceParts')>('src/components/pricing/PriceParts.tsx', {
    '@/i18n/client': { useT: (namespace: Namespace) => translator(locale, namespace), useLocale: () => locale },
  });
}

const semantics = { vatDisplay: 'UNSPECIFIED', priceNature: 'SUBJECT_TO_CONSULTATION', priceType: 'STANDARD' } as never;

test('a price subject to consultation says the final price is confirmed at the consultation', () => {
  assert.equal(text(load('en-GB').PriceFinePrint({ service: semantics })), 'Final price confirmed at your consultation');
  assert.equal(text(load('zh-HK').PriceFinePrint({ service: semantics })), '最終價錢於諮詢時確定');
});

test('a consultation-required service shows "From £X", any other shows the plain amount', () => {
  const en = load('en-GB').useFormatServicePrice();
  assert.equal(en({ amountPence: 15700, requiresConsultation: true }), 'From £157.00');
  assert.equal(en({ amountPence: 4000, requiresConsultation: false }), '£40.00');
  const zh = load('zh-HK').useFormatServicePrice();
  assert.equal(zh({ amountPence: 15700, requiresConsultation: true }).endsWith('起'), true);
  assert.equal(zh({ amountPence: 4000, requiresConsultation: false }).includes('起'), false);
});

test('the consultation credit note uses the consultation’s own price and the shared number of months; nothing for a free or unknown one', () => {
  const en = load('en-GB');
  assert.equal(text(en.ConsultationCreditNote({ feePence: 1500 })), 'Consultation £15.00, taken off your treatment if you go ahead within 6 months.');
  assert.equal(text(en.ConsultationCreditNote({ feePence: 2500 })), 'Consultation £25.00, taken off your treatment if you go ahead within 6 months.');
  assert.equal(en.ConsultationCreditNote({ feePence: 0 }), null);
  assert.equal(en.ConsultationCreditNote({ feePence: undefined }), null);
  assert.equal(text(load('zh-HK').ConsultationCreditNote({ feePence: 1500 })), '諮詢費 £15.00，如你在 6 個月內進行療程，會在療程價錢中扣除。');
});
