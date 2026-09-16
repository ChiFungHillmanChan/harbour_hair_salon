import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../test/load-server-module';

const serviceDate = new Date('2026-01-01');
const categoryDate = new Date('2026-04-01');

function fixture(fail = false) {
  const categories = async () => {
    if (fail) throw new Error('database unavailable');
    return [{ slug: 'haircuts', category: 'Haircuts', updatedAt: categoryDate }];
  };
  const service = loadServerModule<typeof import('./sitemap')>('src/app/sitemap.ts', {
    '@/app/lib/prisma': {
      service: { findFirst: async () => ({ updatedAt: serviceDate }), groupBy: async () => [{ category: 'Haircuts', _max: { updatedAt: serviceDate } }] },
      offer: { findFirst: async () => null },
      stylist: { findMany: async () => [] },
      blogPost: { findMany: async () => [] },
      serviceCategoryContent: { findMany: categories },
      siteSettings: { findUnique: async () => null },
      review: { aggregate: async () => ({ _max: { updatedAt: null } }) },
      faq: { groupBy: async () => [] },
    },
    '@/app/stylists/slug': { slugify: (name: string) => name.toLowerCase().replaceAll(' ', '-') },
    '@/app/lib/site-url': { SITE_URL: 'https://salon.example' },
  });
  return service;
}

test('category sitemap lastmod includes newer category copy changes', async () => {
  const entries = await fixture().default();
  assert.equal(entries.find((entry) => entry.url.endsWith('/services/haircuts'))?.lastModified, categoryDate);
});

test('a sitemap database failure rejects regeneration instead of publishing missing URLs', async () => {
  await assert.rejects(fixture(true).default(), /database unavailable/);
});

test('static sitemap entries do not invent modification dates from generation time', async () => {
  const entries = await fixture().default();
  assert.equal(entries.find((entry) => entry.url.endsWith('/try-color'))?.lastModified, undefined);
});
