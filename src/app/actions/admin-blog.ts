'use server';

import { z } from 'zod';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { fromZonedTime } from 'date-fns-tz';
import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { SALON_TIMEZONE } from '@/app/services/salon-time';
import { getActionT, localizedPath } from '@/i18n/request';
import type { MessageParams } from '@/i18n/format';
import { ContentError, createPublished, deleteContent } from '@/app/services/content/drafts';
import { BLOG_POSTS_TAG } from '@/app/services/blog-service';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') {
    throw new Error('Unauthorized');
  }
  return session;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** What `<input type="datetime-local">` submits: wall-clock text, no timezone. */
const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/**
 * Reads the admin's wall-clock input as salon time. Plain `z.coerce.date()`
 * would resolve it against the server's timezone (UTC on Vercel), so a post
 * edited during BST crept forward an hour on every save; the form renders the
 * value back in Europe/London, so both ends now agree.
 */
const publishedAtSchema = z.preprocess((value: unknown) => {
  if (typeof value === 'string' && DATETIME_LOCAL_RE.test(value)) {
    const withSeconds = value.length === 16 ? `${value}:00` : value;
    return fromZonedTime(withSeconds, SALON_TIMEZONE);
  }
  return value;
}, z.coerce.date('PUBLISHED_AT'));

/**
 * Post SETTINGS — saved immediately, in both languages at once: address,
 * byline, date, cover image, tags, related posts and whether the post is
 * listed on /blog at all. The article text (title, descriptions, cover alt
 * text, lede and body sections) is bilingual content: created with both
 * languages here, then edited as a draft that goes live on publish
 * (actions/admin-content.ts).
 */
const settingsSchema = z.object({
  slug: z
    .string()
    .trim()
    .max(120, 'SLUG')
    .optional()
    .transform((v) => (v ? slugify(v) : '')),
  author: z.string('AUTHOR').trim().min(1, 'AUTHOR').max(80, 'AUTHOR'),
  publishedAt: publishedAtSchema,
  readingTime: z.coerce.number('READING_TIME').int('READING_TIME').min(1, 'READING_TIME').max(60, 'READING_TIME'),
  tags: z.string().trim().max(200, 'TAGS').default(''),
  // Keep this a root-relative path (e.g. /images/post.webp) wherever possible:
  // the article schema in /blog/[slug] builds its image as `${SITE_URL}${coverImage}`,
  // so a bare filename or an unsupported host yields a broken absolute URL, and
  // next/image 400s on any remote host missing from next.config images.remotePatterns.
  coverImage: z
    .string('COVER_IMAGE')
    .trim()
    .min(1, 'COVER_IMAGE')
    .regex(/^\/|^https:\/\/(res\.cloudinary\.com|[a-z0-9-]+\.googleusercontent\.com)\//, 'COVER_IMAGE'),
  relatedSlugs: z.string().trim().max(300, 'RELATED').default(''),
  status: z.enum(['DRAFT', 'PUBLISHED'], 'STATUS').default('DRAFT'),
});

export type BlogActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

async function message(code: string, params?: MessageParams): Promise<string> {
  const t = await getActionT('adminContent');
  return t.dynamic(`blog.errors.${code}`, params, t('blog.errors.INVALID'));
}

async function errorState(code: string, params?: MessageParams): Promise<BlogActionState> {
  return { status: 'error', message: await message(code, params) };
}

function parseSettings(formData: FormData) {
  return settingsSchema.safeParse(Object.fromEntries(formData));
}

function refreshBlogPages(...slugs: string[]) {
  // The list reads its cards from the Data Cache (services/blog-service.ts).
  updateTag(BLOG_POSTS_TAG);
  revalidateAllLocales(revalidatePath, '/blog');
  for (const slug of new Set(slugs)) revalidateAllLocales(revalidatePath, `/blog/${slug}`);
  revalidateAllLocales(revalidatePath, '/admin/blog');
  revalidatePath('/sitemap.xml');
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

export async function createBlogPost(
  _prev: BlogActionState,
  formData: FormData
): Promise<BlogActionState> {
  const session = await requireAdmin();
  const parsed = parseSettings(formData);
  if (!parsed.success) return errorState(parsed.error.issues[0]?.message ?? 'INVALID');

  let contentFields: unknown = null;
  try {
    contentFields = JSON.parse(String(formData.get('contentJson') ?? 'null'));
  } catch {
    return errorState('CONTENT');
  }
  const englishTitle = (contentFields as { 'en-GB'?: { title?: unknown } } | null)?.['en-GB']?.title;

  // The address comes from the English title unless one is given, as before.
  const slug = parsed.data.slug || slugify(text(englishTitle));
  if (!slug) return errorState('SLUG_EMPTY');

  const duplicate = await prisma.blogPost.findUnique({ where: { slug }, select: { id: true } });
  if (duplicate) return errorState('SLUG_TAKEN', { slug });

  let createdId: string;
  try {
    const created = await prisma.$transaction((tx) => createPublished(
      tx,
      'BLOG_POST',
      { fields: contentFields, confirmedReviewed: formData.get('contentReviewed') === 'on', adminId: session.userId },
      (english) => tx.blogPost.create({
        data: {
          ...parsed.data,
          slug,
          title: text(english.title),
          description: text(english.description),
          excerpt: text(english.excerpt),
          authorRole: text(english.authorRole),
          coverAlt: text(english.coverAlt),
          lede: text(english.lede),
          sectionsJson: JSON.stringify(Array.isArray(english.sections) ? english.sections : []),
        },
        select: { id: true },
      }),
    ));
    createdId = created.id;
  } catch (error) {
    if (error instanceof ContentError) return errorState('CONTENT');
    throw error;
  }

  refreshBlogPages(slug);
  redirect(await localizedPath(`/admin/blog/${createdId}/edit?saved=1`));
}

/** Save the settings of an existing post (its text is drafted separately). */
export async function updateBlogPost(
  _prev: BlogActionState,
  formData: FormData
): Promise<BlogActionState> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) return errorState('MISSING_ID');
  const existing = await prisma.blogPost.findUnique({ where: { id }, select: { slug: true, title: true } });
  if (!existing) return errorState('NOT_FOUND');

  const parsed = parseSettings(formData);
  if (!parsed.success) return errorState(parsed.error.issues[0]?.message ?? 'INVALID');

  const slug = parsed.data.slug || slugify(existing.title);
  if (!slug) return errorState('SLUG_EMPTY');

  if (slug !== existing.slug) {
    const duplicate = await prisma.blogPost.findUnique({ where: { slug }, select: { id: true } });
    if (duplicate) return errorState('SLUG_TAKEN', { slug });
  }

  await prisma.blogPost.update({
    where: { id },
    data: { ...parsed.data, slug },
  });

  refreshBlogPages(existing.slug, slug);
  return { status: 'success' };
}

/** Result shape shared by the per-row buttons on /admin/blog (see RowActionButton). */
export type BlogRowActionState = { error?: string; success?: boolean };

export async function deleteBlogPost(id: string): Promise<BlogRowActionState> {
  await requireAdmin();
  if (!id) return { error: await message('MISSING_ID') };

  const existing = await prisma.blogPost.findUnique({ where: { id }, select: { slug: true } });
  if (!existing) return { error: await message('NOT_FOUND') };

  try {
    await prisma.$transaction(async (tx) => {
      await deleteContent(tx, 'BLOG_POST', id);
      await tx.blogPost.delete({ where: { id } });
    });
  } catch (error) {
    console.error('deleteBlogPost failed:', error);
    return { error: await message('DELETE_FAILED') };
  }

  refreshBlogPages(existing.slug);
  return { success: true };
}

/**
 * Sets an explicit target status rather than flipping the stored one, so a
 * double-click (or a stale list) lands on the status the admin clicked instead
 * of net-cancelling itself.
 */
export async function toggleBlogPostStatus(
  id: string,
  status: 'DRAFT' | 'PUBLISHED'
): Promise<BlogRowActionState> {
  await requireAdmin();
  if (!id) return { error: await message('MISSING_ID') };
  if (status !== 'DRAFT' && status !== 'PUBLISHED') return { error: await message('STATUS') };

  const existing = await prisma.blogPost.findUnique({ where: { id }, select: { slug: true } });
  if (!existing) return { error: await message('NOT_FOUND') };

  try {
    await prisma.blogPost.update({
      where: { id },
      data: { status },
    });
  } catch (error) {
    console.error('toggleBlogPostStatus failed:', error);
    return { error: await message('STATUS_FAILED') };
  }

  refreshBlogPages(existing.slug);
  return { success: true };
}
