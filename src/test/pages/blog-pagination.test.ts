import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidElement, type ReactNode } from 'react';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';

const { Pagination } = loadServerModule<typeof import('../../components/admin/Pagination')>('src/components/admin/Pagination.tsx', {
  '@/i18n/link': 'a',
  './PaginationText': { PaginationText: () => null },
});

function links(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(links);
  if (!isValidElement<{ href?: string; children?: ReactNode }>(node)) return [];
  if (node.type === Pagination) return links(Pagination(node.props as Parameters<typeof Pagination>[0]));
  return [...(node.props.href ? [node.props.href] : []), ...links(node.props.children)];
}

const io = {
  'next/link': 'a',
  '@/i18n/link': 'a',
  'next/image': 'img',
  '@/app/lib/site-url': { SITE_URL: 'https://salon.example' },
  '@/components/admin/Pagination': { Pagination },
  // next/root-params only exists inside the Next compiler.
  '@/i18n/server': { getLocale: async () => 'en-GB', getT: async (namespace: Namespace) => translator('en-GB', namespace) },
};

test('public journal page uses the requested page and renders working previous/next links', async () => {
  let requested = 0;
  const page = loadServerModule<typeof import('../../app/[locale]/blog/page')>('src/app/[locale]/blog/page.tsx', {
    ...io,
    '@/app/services/blog-service': { getPublishedPosts: async (value: number) => { requested = value; return { posts: [], hasMore: true }; } },
  });
  const input = { searchParams: Promise.resolve({ page: '2' }) };
  const output = await page.default(input);
  assert.equal(requested, 2);
  assert.deepEqual(links(output).filter((href) => href.startsWith('/blog?')), ['/blog?page=1', '/blog?page=3']);
  assert.equal((await page.generateMetadata(input)).alternates?.canonical, '/blog?page=2');
});

test('admin journal authorizes before reading its requested page and keeps a previous link on the last page', async () => {
  const calls: string[] = [];
  const page = loadServerModule<typeof import('../../app/[locale]/admin/blog/page')>('src/app/[locale]/admin/blog/page.tsx', {
    ...io,
    '@/app/lib/session': { requireAdmin: async () => { calls.push('authorize'); } },
    '@/app/services/blog-service': { getAllPostsForAdmin: async (value: number) => { calls.push(`read:${value}`); return { posts: [], hasMore: false, total: 23, publishedCount: 21, draftCount: 2 }; } },
    '@/app/services/admin-content-status': { loadContentStatus: async () => new Map() },
    '@/app/actions/admin-blog': { deleteBlogPost: async () => {}, toggleBlogPostStatus: async () => {} },
    '@/components/admin/RowActionButton': { RowActionButton: () => null },
  });
  const output = await page.default({ searchParams: Promise.resolve({ page: '2' }) });
  assert.deepEqual(calls, ['authorize', 'read:2']);
  assert.deepEqual(links(output).filter((href) => href.startsWith('/admin/blog?')), ['/admin/blog?page=1']);
});
