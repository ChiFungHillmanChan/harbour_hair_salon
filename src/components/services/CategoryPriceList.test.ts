import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

type Element = { type: unknown; props: Record<string, unknown> };
function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  return text((node as Element).props.children);
}

const service = (id: string, priceType: string) => ({ id, name: id, translated: true, priceType, description: null });
const offering = { id: 'o1', name: 'Colour', translated: true, description: null };

function list(locale: Locale, entries: unknown[]) {
  const loaded = loadServerModule<typeof import('./CategoryPriceList')>('src/components/services/CategoryPriceList.tsx', {
    '@/i18n/client': { useT: (namespace: Namespace) => translator(locale, namespace) },
    '@/components/pricing/OfferingPrices': { OfferingPrices: () => null },
    '@/components/pricing/PriceParts': { Duration: () => null, PriceFinePrint: () => null, useFormatServicePrice: () => () => '£1.00' },
  });
  return text(loaded.CategoryPriceList({ entries: entries as never }));
}

for (const locale of ['en-GB', 'zh-HK'] as const) {
  test(`${locale}: a category page says what NHS and student prices need only when one is listed`, () => {
    const note = translator(locale, 'pricing')('eligibilityProof');
    assert.ok(list(locale, [{ kind: 'offering', offering, options: [service('a', 'STANDARD'), service('b', 'NHS')] }]).includes(note), 'an NHS option in a menu item');
    assert.ok(list(locale, [{ kind: 'single', service: service('c', 'NHS') }]).includes(note), 'a standalone NHS service');
    assert.ok(!list(locale, [{ kind: 'offering', offering, options: [service('a', 'STANDARD')] }, { kind: 'single', service: service('c', 'STANDARD') }]).includes(note), 'standard only');
  });
}
