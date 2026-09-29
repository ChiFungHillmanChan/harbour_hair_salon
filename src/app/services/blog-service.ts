import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import prisma from '@/app/lib/prisma';
import type { BlogPost, Prisma } from '@prisma/client';
import type { Locale } from '@/i18n/config';
import { loadPublishedTranslations, overlay } from './content/translations';

export type BlogSection =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'quote'; text: string; attribution?: string };

export type BlogPostRuntime = {
  id: string;
  slug: string;
  title: string;
  description: string;
  excerpt: string;
  author: string;
  authorRole: string;
  publishedAt: Date;
  updatedAt: Date;
  readingTime: number;
  tags: string[];
  coverImage: string;
  coverAlt: string;
  lede: string;
  sections: BlogSection[];
  relatedSlugs: string[];
  status: 'DRAFT' | 'PUBLISHED';
  /** False when shown in English because no translation is published. */
  translated: boolean;
};

function parseSections(json: string): BlogSection[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSection);
  } catch {
    return [];
  }
}

function isValidSection(s: unknown): s is BlogSection {
  if (!s || typeof s !== 'object') return false;
  const obj = s as Record<string, unknown>;
  if (obj.type === 'paragraph') return typeof obj.text === 'string';
  if (obj.type === 'heading') return (obj.level === 2 || obj.level === 3) && typeof obj.text === 'string';
  if (obj.type === 'list') return Array.isArray(obj.items) && obj.items.every((i) => typeof i === 'string');
  if (obj.type === 'quote') return typeof obj.text === 'string';
  return false;
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function mapToRuntime(row: BlogPost): BlogPostRuntime {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    excerpt: row.excerpt,
    author: row.author,
    authorRole: row.authorRole,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    readingTime: row.readingTime,
    tags: splitCsv(row.tags),
    coverImage: row.coverImage,
    coverAlt: row.coverAlt,
    lede: row.lede,
    sections: parseSections(row.sectionsJson),
    relatedSlugs: splitCsv(row.relatedSlugs),
    status: (row.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT') as 'PUBLISHED' | 'DRAFT',
    translated: true,
  };
}

const isSectionList = (value: unknown): value is BlogSection[] => Array.isArray(value) && value.every(isValidSection);

const postCardSelect = {
  id: true, slug: true, title: true, excerpt: true, author: true,
  publishedAt: true, readingTime: true, coverImage: true, coverAlt: true,
} satisfies Prisma.BlogPostSelect;

/** Data Cache tag for the blog list. Every blog or translation publish drops it. */
export const BLOG_POSTS_TAG = 'blog-posts';
const BLOG_PAGE_SIZE = 12;

/**
 * Every published post card in one language, from the Data Cache.
 *
 * The list page is dynamic (it reads `?page=`), so this used to run two
 * queries against Neon on EVERY visit — and a bot walking `?page=1…9999` could
 * keep the compute awake on its own. Now all page numbers share one entry per
 * language; nothing reaches the database until a post or its translation is
 * published (actions/admin-blog.ts and actions/admin-content.ts drop the tag).
 * The day-long expiry is only a safety net: a timed expiry is itself a poll
 * (CLAUDE.md, "Neon compute budget"). Cards are small and posts few, so one
 * entry stays far below the cache's size limit.
 */
const readPublishedCards = unstable_cache(
  async (locale: Locale) => {
    const rows = await prisma.blogPost.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: postCardSelect,
    });
    if (locale === 'en-GB') return rows.map((post) => ({ ...post, translated: true }));
    const translations = await loadPublishedTranslations(prisma, 'BLOG_POST', rows.map((post) => post.id), locale);
    return rows.map((post) => overlay(post, translations.get(post.id), ['title', 'excerpt', 'coverAlt']));
  },
  ['blog-published-cards'],
  { revalidate: 24 * 60 * 60, tags: [BLOG_POSTS_TAG] },
);

/** Lists never load article bodies. */
export const getPublishedPosts = cache(async (page = 1, locale: Locale = 'en-GB') => {
  const cards = await readPublishedCards(locale);
  const start = (Math.max(1, Math.min(9999, Math.floor(page) || 1)) - 1) * BLOG_PAGE_SIZE;
  // The Data Cache stores JSON, so dates come back as strings.
  const posts = cards.slice(start, start + BLOG_PAGE_SIZE).map((post) => ({ ...post, publishedAt: new Date(post.publishedAt) }));
  return { posts, hasMore: cards.length > start + BLOG_PAGE_SIZE };
});

export async function getPublishedPostSlugs() {
  return prisma.blogPost.findMany({ where: { status: 'PUBLISHED' }, select: { slug: true } });
}

export async function getRelatedPublishedPosts(slugs: string[], locale: Locale = 'en-GB') {
  const requested = [...new Set(slugs)].slice(0, 8);
  if (!requested.length) return [];
  const found = await prisma.blogPost.findMany({
    where: { status: 'PUBLISHED', slug: { in: requested } },
    select: { id: true, slug: true, title: true, excerpt: true },
    take: requested.length,
  });
  const translations = await loadPublishedTranslations(prisma, 'BLOG_POST', found.map((row) => row.id), locale);
  const rows = found.map((row) => (locale === 'en-GB' ? { ...row, translated: true } : overlay(row, translations.get(row.id), ['title', 'excerpt'])));
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return requested.flatMap((slug) => bySlug.has(slug) ? [bySlug.get(slug)!] : []);
}

// Metadata and the page body share one full article query per request.
export const getPublishedPostBySlug = cache(async (slug: string, locale: Locale = 'en-GB'): Promise<BlogPostRuntime | null> => {
  const row = await prisma.blogPost.findUnique({ where: { slug } });
  if (!row) return null;
  if (row.status !== 'PUBLISHED') return null;
  const post = mapToRuntime(row);
  if (locale === 'en-GB') return post;
  const translations = await loadPublishedTranslations(prisma, 'BLOG_POST', [post.id], locale);
  const fields = translations.get(post.id);
  // Sections are validated like the English ones; a malformed translation falls back.
  const safe = fields && !isSectionList(fields.sections) ? { ...fields, sections: undefined } : fields;
  return overlay(post, safe, ['title', 'description', 'excerpt', 'authorRole', 'coverAlt', 'lede', 'sections']);
});

export async function getAllPostsForAdmin(page = 1) {
  const size = 20;
  const [rows, counts] = await Promise.all([
    prisma.blogPost.findMany({
      orderBy: [{ status: 'asc' }, { publishedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, slug: true, title: true, publishedAt: true, status: true },
      skip: (Math.max(1, Math.min(9999, Math.floor(page) || 1)) - 1) * size,
      take: size + 1,
    }),
    prisma.blogPost.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  return {
    posts: rows.slice(0, size), hasMore: rows.length > size,
    total: counts.reduce((sum, row) => sum + row._count._all, 0),
    publishedCount: counts.find((row) => row.status === 'PUBLISHED')?._count._all ?? 0,
    draftCount: counts.find((row) => row.status === 'DRAFT')?._count._all ?? 0,
  };
}

export async function getPostById(id: string): Promise<BlogPostRuntime | null> {
  const row = await prisma.blogPost.findUnique({ where: { id } });
  return row ? mapToRuntime(row) : null;
}
