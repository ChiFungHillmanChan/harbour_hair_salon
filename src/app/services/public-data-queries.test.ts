import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

type Query = { select?: Record<string, boolean>; take?: number; skip?: number; where?: Record<string, unknown> };
const row = { id: 'p', slug: 'post', title: 'Post', description: 'Description', excerpt: 'Excerpt', author: 'Salon', authorRole: 'Stylist', publishedAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'), readingTime: 5, tags: '', coverImage: '/post.webp', coverAlt: 'Hair', lede: 'Intro', sectionsJson: '[{"type":"paragraph","text":"Full article body"}]', relatedSlugs: '', status: 'PUBLISHED' };

function blogFixture() {
  const queries: Query[] = [];
  const posts = Array.from({ length: 30 }, (_, i) => ({ ...row, id: `p${i}`, slug: `post-${i}` }));
  // A stand-in for the Data Cache: one stored entry per key, kept as JSON like
  // the real one (so dates come back as strings).
  const store = new Map<string, unknown>();
  const cacheOptions = new Map<string, { revalidate?: number | false; tags?: string[] }>();
  const service = loadServerModule<typeof import('./blog-service')>('src/app/services/blog-service.ts', {
    '@/app/lib/prisma': { blogPost: {
      findMany: async (query: Query) => { queries.push(query); return posts.slice(query.skip ?? 0, query.take ? (query.skip ?? 0) + query.take : undefined); },
      groupBy: async () => [{ status: 'PUBLISHED', _count: { _all: 30 } }],
    } },
    'next/cache': {
      unstable_cache: (read: (...args: unknown[]) => Promise<unknown>, keyParts: string[], options: { revalidate?: number | false; tags?: string[] }) => {
        cacheOptions.set(keyParts.join('/'), options);
        return async (...args: unknown[]) => {
          const key = JSON.stringify([keyParts, args]);
          if (!store.has(key)) store.set(key, JSON.parse(JSON.stringify(await read(...args))));
          return store.get(key);
        };
      },
    },
  });
  return { service, queries, cacheOptions };
}

test('every public blog page is served from one cached read of summary cards', async () => {
  const f = blogFixture();
  const second = await f.service.getPublishedPosts(2);
  assert.equal(second.posts.length, 12);
  assert.equal(second.posts[0].id, 'p12');
  assert.equal(second.hasMore, true);
  assert.ok(second.posts[0].publishedAt instanceof Date, 'dates survive the cache');

  const third = await f.service.getPublishedPosts(3);
  assert.deepEqual(third.posts.map((post) => post.id), ['p24', 'p25', 'p26', 'p27', 'p28', 'p29']);
  assert.equal(third.hasMore, false);

  // A bot walking ?page=… reads nothing more from the database.
  const beyond = await f.service.getPublishedPosts(9999);
  assert.deepEqual(beyond, { posts: [], hasMore: false });
  assert.equal(f.queries.length, 1, 'one query serves every page number');
  assert.ok(f.queries[0].select);
  assert.ok(!('sectionsJson' in f.queries[0].select!), 'lists never load article bodies');

  // Dropped by every publish; the timer is only a safety net (Neon budget).
  const options = f.cacheOptions.get('blog-published-cards');
  assert.deepEqual(options?.tags, ['blog-posts']);
  assert.ok(options?.revalidate === false || (typeof options?.revalidate === 'number' && options.revalidate >= 12 * 60 * 60));
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
