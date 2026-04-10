'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';

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
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const sectionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), text: z.string().min(1) }),
  z.object({
    type: z.literal('heading'),
    level: z.union([z.literal(2), z.literal(3)]),
    text: z.string().min(1),
  }),
  z.object({ type: z.literal('list'), items: z.array(z.string().min(1)).min(1) }),
  z.object({
    type: z.literal('quote'),
    text: z.string().min(1),
    attribution: z.string().optional(),
  }),
]);

const postSchema = z.object({
  slug: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? slugify(v) : '')),
  title: z.string().trim().min(3, 'Title is required').max(180),
  description: z.string().trim().min(20, 'Description must be at least 20 characters').max(300),
  excerpt: z.string().trim().min(20, 'Excerpt must be at least 20 characters').max(400),
  author: z.string().trim().min(1).max(80),
  authorRole: z.string().trim().min(1).max(120),
  publishedAt: z.coerce.date(),
  readingTime: z.coerce.number().int().min(1).max(60),
  tags: z.string().trim().max(200).default(''),
  coverImage: z.string().trim().min(1),
  coverAlt: z.string().trim().min(1).max(200),
  lede: z.string().trim().min(20).max(500),
  sectionsJson: z.string().min(2),
  relatedSlugs: z.string().trim().max(300).default(''),
  status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT'),
});

type ParsedBlogForm =
  | { error: string }
  | {
      data: z.infer<typeof postSchema>;
      sections: z.infer<typeof sectionSchema>[];
    };

function parseFormData(formData: FormData): ParsedBlogForm {
  const raw = Object.fromEntries(formData);
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' } as const;
  }

  // Validate sections JSON structure explicitly (schema only checks it's a non-empty string)
  let sections: unknown;
  try {
    sections = JSON.parse(parsed.data.sectionsJson);
  } catch {
    return { error: 'Body content is invalid. Please re-check the sections.' } as const;
  }
  if (!Array.isArray(sections) || sections.length === 0) {
    return { error: 'Please add at least one section to the post body.' } as const;
  }
  const sectionsValidation = z.array(sectionSchema).safeParse(sections);
  if (!sectionsValidation.success) {
    return {
      error: `Section ${(sectionsValidation.error.issues[0]?.path[0] as number) + 1 || 1} is invalid.`,
    } as const;
  }

  return { data: parsed.data, sections: sectionsValidation.data };
}

function getParseErrorMessage(
  result: ParsedBlogForm,
): string {
  return 'error' in result ? result.error : 'Invalid input';
}

export type BlogActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

export async function createBlogPost(
  _prev: BlogActionState,
  formData: FormData
): Promise<BlogActionState> {
  await requireAdmin();
  const result = parseFormData(formData);
  if ('error' in result) return { status: 'error', message: getParseErrorMessage(result) };

  const slug = result.data.slug || slugify(result.data.title);
  if (!slug) return { status: 'error', message: 'Could not derive a slug from title.' };

  const duplicate = await prisma.blogPost.findUnique({ where: { slug } });
  if (duplicate) {
    return {
      status: 'error',
      message: `A post with slug "${slug}" already exists. Pick a different slug.`,
    };
  }

  const created = await prisma.blogPost.create({
    data: {
      slug,
      title: result.data.title,
      description: result.data.description,
      excerpt: result.data.excerpt,
      author: result.data.author,
      authorRole: result.data.authorRole,
      publishedAt: result.data.publishedAt,
      readingTime: result.data.readingTime,
      tags: result.data.tags,
      coverImage: result.data.coverImage,
      coverAlt: result.data.coverAlt,
      lede: result.data.lede,
      sectionsJson: JSON.stringify(result.sections),
      relatedSlugs: result.data.relatedSlugs,
      status: result.data.status,
    },
  });

  revalidatePath('/blog');
  revalidatePath(`/blog/${slug}`);
  revalidatePath('/admin/blog');
  revalidatePath('/sitemap.xml');

  redirect(`/admin/blog/${created.id}/edit?saved=1`);
}

export async function updateBlogPost(
  _prev: BlogActionState,
  formData: FormData
): Promise<BlogActionState> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) {
    return { status: 'error', message: 'Missing post id.' };
  }
  const existing = await prisma.blogPost.findUnique({ where: { id } });
  if (!existing) return { status: 'error', message: 'Post not found.' };

  const result = parseFormData(formData);
  if ('error' in result) return { status: 'error', message: getParseErrorMessage(result) };

  const slug = result.data.slug || slugify(result.data.title);
  if (!slug) return { status: 'error', message: 'Could not derive a slug from title.' };

  if (slug !== existing.slug) {
    const duplicate = await prisma.blogPost.findUnique({ where: { slug } });
    if (duplicate) {
      return {
        status: 'error',
        message: `A post with slug "${slug}" already exists. Pick a different slug.`,
      };
    }
  }

  await prisma.blogPost.update({
    where: { id },
    data: {
      slug,
      title: result.data.title,
      description: result.data.description,
      excerpt: result.data.excerpt,
      author: result.data.author,
      authorRole: result.data.authorRole,
      publishedAt: result.data.publishedAt,
      readingTime: result.data.readingTime,
      tags: result.data.tags,
      coverImage: result.data.coverImage,
      coverAlt: result.data.coverAlt,
      lede: result.data.lede,
      sectionsJson: JSON.stringify(result.sections),
      relatedSlugs: result.data.relatedSlugs,
      status: result.data.status,
    },
  });

  revalidatePath('/blog');
  revalidatePath(`/blog/${existing.slug}`);
  if (slug !== existing.slug) revalidatePath(`/blog/${slug}`);
  revalidatePath('/admin/blog');
  revalidatePath('/sitemap.xml');

  return { status: 'success' };
}

export async function deleteBlogPost(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string') throw new Error('Invalid id');

  const existing = await prisma.blogPost.findUnique({ where: { id } });
  if (!existing) return;

  await prisma.blogPost.delete({ where: { id } });

  revalidatePath('/blog');
  revalidatePath(`/blog/${existing.slug}`);
  revalidatePath('/admin/blog');
  revalidatePath('/sitemap.xml');
}

export async function toggleBlogPostStatus(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string') throw new Error('Invalid id');

  const existing = await prisma.blogPost.findUnique({ where: { id } });
  if (!existing) return;

  const newStatus = existing.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
  await prisma.blogPost.update({
    where: { id },
    data: { status: newStatus },
  });

  revalidatePath('/blog');
  revalidatePath(`/blog/${existing.slug}`);
  revalidatePath('/admin/blog');
  revalidatePath('/sitemap.xml');
}
