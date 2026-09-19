import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, isValidElement, type ReactNode } from 'react';
import { loadServerModule } from '../../test/load-server-module';

function elementTypes(node: unknown): unknown[] {
  if (Array.isArray(node)) return node.flatMap(elementTypes);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node.type, ...elementTypes(node.props.children)];
}

test('homepage footer chrome is identical before and after the router resolves its pathname', () => {
  let pathname: string | null = null;
  const { FooterSwitcher } = loadServerModule<typeof import('./FooterSwitcher')>('src/components/layout/FooterSwitcher.tsx', {
    'next/navigation': { usePathname: () => pathname },
  });
  const props = {
    homePromotions: createElement('aside', { 'aria-label': 'Booking' }),
    footer: createElement('footer'),
    mobileBookBar: createElement('nav'),
  };
  const server = elementTypes(FooterSwitcher(props));
  pathname = '/';
  assert.deepEqual(elementTypes(FooterSwitcher(props)), server,
    'Resolving the homepage pathname must not insert an aside ahead of the server-rendered footer');
  pathname = '/auth/signin';
  assert.equal(FooterSwitcher(props), null);
});

test('the server-rendered homepage owns its booking promotion without reading a router pathname', async () => {
  const component = () => null;
  const FooterPromotions = () => null;
  const { default: Home } = loadServerModule<typeof import('../../app/page')>('src/app/page.tsx', {
    '@/app/lib/prisma': {
      service: { findMany: async () => [] },
      stylist: { findMany: async () => [] },
      offer: { findFirst: async () => null },
    },
    '@/components/home/Hero': { Hero: component },
    '@/components/home/ServiceMenu': { ServiceMenu: component },
    '@/components/home/StylistShowcase': { StylistShowcase: component },
    '@/components/home/SocialProofBar': { SocialProofBar: component },
    '@/components/home/TrustBar': { TrustBar: component },
    '@/components/home/VisitFollowBlock': { __esModule: true, default: component },
    '@/components/seo/Faq': { Faq: component },
    '@/components/layout/Layout': { FooterPromotions },
    '@/app/services/review-service': { getAggregateRating: async () => ({ count: 0, average: 0 }) },
    '@/app/services/site-settings-service': {
      getSiteSettings: async () => ({ phone: '07831 830898' }),
      buildSameAsArray: () => [],
    },
    '@/app/services/faq-service': { getFaqsByKey: async () => [] },
  });
  const types = elementTypes(await Home());
  assert.equal(types.filter(type => type === FooterPromotions).length, 1,
    'The homepage must include exactly one promotion in its own server output');
});
