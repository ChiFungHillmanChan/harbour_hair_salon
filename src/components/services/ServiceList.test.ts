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

// The real "From" range (STANDARD prices only); its module's database client is never used here.
const { standardPriceRange } = loadServerModule<typeof import('../../app/services/pricing/public-catalog')>('src/app/services/pricing/public-catalog.ts', {
  '@/app/lib/prisma': { __esModule: true, default: {} },
  '../content/translations': { loadPublishedTranslations: async () => new Map(), overlay: (value: object) => value },
});

const service = (id: string, amountPence: number, requiresConsultation: boolean, priceType = 'STANDARD') => ({
  id, name: id, translated: true, description: null, priceNote: null, priceType, amountPence, requiresConsultation,
  vatDisplay: 'EXCLUDED', priceNature: requiresConsultation ? 'SUBJECT_TO_CONSULTATION' : 'LISTED', duration: 60,
});

/** The category header's price line, for a list with one category of these services. */
function header(locale: Locale, services: ReturnType<typeof service>[]) {
  const loaded = loadServerModule<typeof import('./ServiceList')>('src/components/services/ServiceList.tsx', {
    react: { useMemo: (run: () => unknown) => run() },
    '@/i18n/link': { __esModule: true, default: (props: Record<string, unknown>) => ({ type: 'a', props }) },
    '@/i18n/client': { useT: (namespace: Namespace) => translator(locale, namespace) },
    '@/i18n/draft-store': { useDraftState: (_key: string, value: unknown) => [value, () => undefined] },
    '@/app/services/pricing/public-catalog': { standardPriceRange },
    '@/components/pricing/OfferingPrices': { OfferingPrices: () => null },
    '@/components/pricing/PriceParts': {
      ConsultationCreditNote: () => null, Duration: () => null, PriceFinePrint: () => null,
      useCategoryLabel: () => (category: string) => category,
      useFormatPrice: () => (pence: number) => `£${pence / 100}`,
      useFormatServicePrice: () => (option: { amountPence: number }) => `£${option.amountPence / 100}`,
    },
  });
  const tree = loaded.ServiceList({ categories: [{ category: 'Perms', entries: services.map((one) => ({ kind: 'single', service: one })) as never }] });
  // The header is the block whose label is pricing.from.
  const from = translator(locale, 'pricing')('from');
  const stack: unknown[] = [tree];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) { stack.push(...node); continue; }
    if (!node || typeof node !== 'object' || !('props' in node)) continue;
    const children = (node as Element).props.children;
    const parts = Array.isArray(children) ? children : [children];
    if (parts.length === 2 && text(parts[0]) === from) return text(parts[1]).trim();
    stack.push(children);
  }
  return null;
}

for (const locale of ['en-GB', 'zh-HK'] as const) {
  const range = (min: string, max: string) => translator(locale, 'pricing')('range', { min, max });

  // Final review M4: a consultation-required price is a starting point, so a
  // category made only of them advertises where prices start, never an upper bound.
  test(`${locale}: a category whose every service needs a consultation shows only "From £min"`, () => {
    assert.equal(header(locale, [service('perm-a', 15700, true), service('perm-b', 24200, true)]), '£157');
    // NHS prices never set the advertised minimum.
    assert.equal(header(locale, [service('perm-a', 15700, true), service('perm-nhs', 14300, true, 'NHS'), service('perm-b', 24200, true)]), '£157');
  });

  test(`${locale}: any other category keeps its "£min – £max" range`, () => {
    assert.equal(header(locale, [service('cut-a', 3700, false), service('cut-b', 4900, false)]), range('£37', '£49'));
    assert.equal(header(locale, [service('cut-a', 3700, false), service('perm-b', 24200, true)]), range('£37', '£242'), 'a mixed category');
    assert.equal(header(locale, [service('one', 3700, false)]), '£37', 'one price: no range');
  });
}
