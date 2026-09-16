import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

type Query = { select?: Record<string, boolean>; take?: number; skip?: number; where?: Record<string, unknown> };
const row = { id: 'p', slug: 'post', title: 'Post', description: 'Description', excerpt: 'Excerpt', author: 'Salon', authorRole: 'Stylist', publishedAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'), readingTime: 5, tags: '', coverImage: '/post.webp', coverAlt: 'Hair', lede: 'Intro', sectionsJson: '[{"type":"paragraph","text":"Full article body"}]', relatedSlugs: '', status: 'PUBLISHED' };

function blogFixture() {
  const queries: Query[] = [];
  const posts = Array.from({ length: 30 }, (_, i) => ({ ...row, id: `p${i}`, slug: `post-${i}` }));
  const service = loadServerModule<typeof import('./blog-service')>('src/app/services/blog-service.ts', {
    '@/app/lib/prisma': { blogPost: {
      findMany: async (query: Query) => { queries.push(query); return posts.slice(query.skip ?? 0, query.take ? (query.skip ?? 0) + query.take : undefined); },
      groupBy: async () => [{ status: 'PUBLISHED', _count: { _all: 30 } }],
    } },
  });
  return { service, queries };
}

test('public blog pagination reads a bounded summary page and exposes the next page', async () => {
  const f = blogFixture();
  const result = await f.service.getPublishedPosts(2);
  assert.equal(f.queries[0].take, 13);
  assert.equal(f.queries[0].skip, 12);
  assert.ok(f.queries[0].select);
  assert.ok(!('sectionsJson' in f.queries[0].select!));
  assert.equal(result.posts.length, 12);
  assert.equal(result.posts[0].id, 'p12');
  assert.equal(result.hasMore, true);
});

test('admin blog pagination uses summary fields while totals describe all posts', async () => {
  const f = blogFixture();
  const result = await f.service.getAllPostsForAdmin(2);
  assert.ok(f.queries[0].select);
  assert.ok(!('sectionsJson' in f.queries[0].select!));
  assert.equal(result.posts[0].id, 'p20');
  assert.equal(result.hasMore, false);
  assert.equal(result.total, 30);
  assert.equal(result.publishedCount, 30);
});

test('category navigation reads no content JSON', async () => {
  let query: Query = {};
  const service = loadServerModule<typeof import('./category-content-service')>('src/app/services/category-content-service.ts', {
    '@/app/lib/prisma': { serviceCategoryContent: { findMany: async (value: Query) => { query = value; return []; } } },
  });
  await service.getAllCategoryContent();
  assert.ok(query.select);
  assert.ok(query.select!.slug && query.select!.category);
  assert.ok(!('overviewJson' in query.select!));
});

test('a known stylist slug uses its unique lookup without scanning the roster', async () => {
  let scans = 0;
  let lookups = 0;
  const stylist = { id: 's', slug: 'ivan', name: 'Ivan', isActive: true, role: 'Stylist', specialtiesJson: '[]', languagesJson: '[]', extendedBioJson: '[]' };
  const service = loadServerModule<typeof import('../stylists/slug')>('src/app/stylists/slug.ts', {
    '@/app/lib/prisma': { stylist: {
      findUnique: async () => { lookups++; return stylist; },
      findMany: async () => { scans++; return [stylist]; },
    } },
  });
  assert.equal((await service.getStylistBySlug('ivan'))?.id, 's');
  assert.equal(lookups, 1);
  assert.equal(scans, 0);
});

test('legacy stylist fallback only scans active rows with null slugs', async () => {
  let query: Query = {};
  const stylist = { id: 'legacy', slug: null, name: 'Legacy Stylist', role: 'Stylist', specialtiesJson: '[]', languagesJson: '[]', extendedBioJson: '[]' };
  const service = loadServerModule<typeof import('../stylists/slug')>('src/app/stylists/slug.ts', {
    '@/app/lib/prisma': { stylist: {
      findUnique: async () => null,
      findMany: async (value: Query) => { query = value; return [stylist]; },
    } },
  });
  assert.equal((await service.getStylistBySlug('legacy-stylist'))?.id, 'legacy');
  assert.deepEqual(query.where, { isActive: true, slug: null });
});
