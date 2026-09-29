import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

// The public blog list reads its cards from the Data Cache (services/blog-service.ts).
// Every way a post or its translation changes must drop that entry, or the list
// keeps showing the old text until the day-long safety-net expiry.

function cacheSpy() {
  const tags: string[] = [];
  return { tags, nextCache: { updateTag: (tag: string) => { tags.push(tag); }, revalidatePath: () => undefined } };
}

test('deleting a blog post drops the cached list', async () => {
  const spy = cacheSpy();
  const tx = { blogPost: { delete: async () => ({}) } };
  const actions = loadServerModule<typeof import('./admin-blog')>('src/app/actions/admin-blog.ts', {
    'next/cache': spy.nextCache,
    '@/app/lib/prisma': {
      blogPost: { findUnique: async () => ({ slug: 'old-post' }) },
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: 'ADMIN' }) },
    '@/app/services/content/drafts': { deleteContent: async () => undefined, ContentError: class extends Error {} },
    '@/app/services/blog-service': { BLOG_POSTS_TAG: 'blog-posts' },
    'next/navigation': { redirect: () => { throw new Error('Unexpected redirect'); } },
  });
  assert.deepEqual(await actions.deleteBlogPost('post-1'), { success: true });
  assert.deepEqual(spy.tags, ['blog-posts']);
});

test('publishing a blog translation drops the cached list', async () => {
  const spy = cacheSpy();
  const actions = loadServerModule<typeof import('./admin-content')>('src/app/actions/admin-content.ts', {
    'next/cache': spy.nextCache,
    '@/app/lib/prisma': { $transaction: async (run: (client: object) => Promise<unknown>) => run({}) },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: 'ADMIN' }) },
    '@/app/services/content/drafts': {
      publishDraft: async () => undefined,
      getEditorState: async () => ({ revision: 2 }),
      ContentError: class extends Error {},
    },
    '@/app/services/pricing/service-price': { applyServicePrice: async () => undefined, ServicePriceError: class extends Error {} },
    '@/app/services/blog-service': { BLOG_POSTS_TAG: 'blog-posts' },
  });
  const result = await actions.publishContentAction('BLOG_POST', 'post-1');
  assert.equal(result.ok, true);
  assert.ok(spy.tags.includes('blog-posts'));
});
