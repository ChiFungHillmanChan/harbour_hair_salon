import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

type Element = { type: unknown; props: Record<string, unknown> };

function render(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(render);
  if (!node || typeof node !== 'object' || !('props' in node)) return node;
  const element = node as Element;
  if (typeof element.type === 'function') return render((element.type as (props: unknown) => unknown)(element.props));
  return { ...element, props: { ...element.props, children: render(element.props.children) } };
}

function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  return text((node as Element).props.children);
}

/** The page with discounts paused or active; the database is only read when they are active. */
async function offersPage(locale: Locale, paused: boolean) {
  const page = loadServerModule<typeof import('../../app/[locale]/offers/page')>('src/app/[locale]/offers/page.tsx', {
    'next/image': { __esModule: true, default: () => null },
    '@/app/lib/prisma': { offer: { findMany: async () => [] } },
    '@/app/services/pricing/policy': { DISCOUNTS_PAUSED: paused },
    '@/app/services/content/translations': { loadPublishedTranslations: async () => new Map(), overlay: (value: unknown) => value },
    '@/i18n/link': { __esModule: true, default: (props: Record<string, unknown>) => ({ type: 'a', props }) },
    '@/i18n/server': { getLocale: async () => locale, getT: async (namespace: Namespace) => translator(locale, namespace) },
  });
  return text(render(await page.default()));
}

for (const locale of ['en-GB', 'zh-HK'] as const) {
  test(`${locale}: the offer terms show under the offers while offers are active, and not while they are paused`, async () => {
    const t = translator(locale, 'legal');
    const terms = ['oneCode', 'noCombine', 'noCashValue', 'proof', 'withdraw'].map((key) => t(`bookingTerms.offers.${key}` as 'bookingTerms.offers.oneCode'));
    const active = await offersPage(locale, false);
    assert.ok(active.includes(t('bookingTerms.offers.title')));
    for (const term of terms) assert.ok(active.includes(term), term);
    const paused = await offersPage(locale, true);
    for (const term of terms) assert.ok(!paused.includes(term), `paused: ${term}`);
    assert.ok(!paused.includes(t('bookingTerms.offers.title')));
  });
}
