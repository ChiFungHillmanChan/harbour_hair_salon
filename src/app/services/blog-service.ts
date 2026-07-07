import 'server-only';
import { cache } from 'react';
import prisma from '@/app/lib/prisma';

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

type DbBlogPost = {
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
  tags: string;
  coverImage: string;
  coverAlt: string;
  lede: string;
  sectionsJson: string;
  relatedSlugs: string;
  status: string;
};

function mapToRuntime(row: DbBlogPost): BlogPostRuntime {
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
  };
}

export async function getPublishedPosts(): Promise<BlogPostRuntime[]> {
  const rows = await prisma.blogPost.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
  });
  return rows.map(mapToRuntime);
}

// Wrapped in React cache() so generateMetadata + the page body (and the
// related-posts lookups) share one query per slug per request instead of
// each hitting the DB separately.
export const getPublishedPostBySlug = cache(async (slug: string): Promise<BlogPostRuntime | null> => {
  const row = await prisma.blogPost.findUnique({ where: { slug } });
  if (!row) return null;
  if (row.status !== 'PUBLISHED') return null;
  return mapToRuntime(row);
});

export async function getAllPostsForAdmin(): Promise<BlogPostRuntime[]> {
  const rows = await prisma.blogPost.findMany({
    orderBy: [{ status: 'asc' }, { publishedAt: 'desc' }],
  });
  return rows.map(mapToRuntime);
}

export async function getPostById(id: string): Promise<BlogPostRuntime | null> {
  const row = await prisma.blogPost.findUnique({ where: { id } });
  return row ? mapToRuntime(row) : null;
}
