import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { translator } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';
import { loadServerModule } from '../../test/load-server-module';

type ElementProps = { children?: ReactNode; href?: string; channel?: string; source?: string; target?: string; rel?: string; id?: string };

function elements(node: unknown): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function component(locale: Locale) {
  return loadServerModule<typeof import('./BookingQuickLinks')>('src/components/home/BookingQuickLinks.tsx', {
    '@/i18n/server': { getT: async () => translator(locale, 'home') },
  }).BookingQuickLinks;
}

const phoneOnly = { phone: '07831 830898', treatwellUrl: '', freshaUrl: '', booksyUrl: '' };

for (const locale of ['en-GB', 'zh-HK'] as const) {
  test(`homepage offers a usable phone booking when all marketplaces are unset (${locale})`, async () => {
    const tree = elements(await component(locale)({ settings: phoneOnly }));
    const links = tree.filter((node) => node.props.href);
    assert.deepEqual(links.map((node) => node.props.href), ['tel:+447831830898']);
    assert.equal(links[0].props.children, translator(locale, 'home')('booking.call', { phone: phoneOnly.phone }));
    assert.equal(links[0].props.channel, 'phone');
    assert.equal(links[0].props.source, 'home_hero');
    assert(tree.some((node) => node.props.children === translator(locale, 'home')('booking.phoneOnly')));
  });

  test(`homepage only links to configured booking channels, with safe external targets (${locale})`, async () => {
    const tree = elements(await component(locale)({
      settings: {
        ...phoneOnly,
        freshaUrl: 'https://example.com/fresha',
        treatwellUrl: 'https://example.com/treatwell',
        booksyUrl: '   ',
      },
      source: 'location_page',
    }));
    const links = tree.filter((node) => node.props.href);
    assert.deepEqual(links.map((node) => [node.props.channel, node.props.href]), [
      ['phone', 'tel:+447831830898'],
      ['Fresha', 'https://example.com/fresha'],
      ['Treatwell', 'https://example.com/treatwell'],
    ]);
    for (const link of links.slice(1)) {
      assert.equal(link.props.target, '_blank');
      assert.equal(link.props.rel, 'noopener noreferrer');
      assert.equal(link.props.children, translator(locale, 'home')('booking.bookOn', { name: link.props.channel }));
    }
    assert(links.every((node) => node.props.source === 'location_page'));
    assert(tree.some((node) => node.props.id === 'location_page-booking-title'));
    assert(tree.some((node) => node.props.children === translator(locale, 'home')('booking.withPartners')));
  });
}
