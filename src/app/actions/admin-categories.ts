'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
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

// Messages are phrased to read as "<block> <n>: <message>" in the admin banner.
const processStepSchema = z.object({
  step: z.string().trim().min(1, 'step name is required').max(200, 'step name is too long (max 200 characters)'),
  detail: z.string().trim().min(1, 'detail is required').max(800, 'detail is too long (max 800 characters)'),
});

const faqSchema = z.object({
  question: z
    .string()
    .trim()
    .min(5, 'question must be at least 5 characters')
    .max(300, 'question is too long (max 300 characters)'),
  answer: z
    .string()
    .trim()
    .min(10, 'answer must be at least 10 characters')
    .max(1200, 'answer is too long (max 1200 characters)'),
});

const listEntrySchema = z.string().trim().min(1, 'cannot be empty');

const contentSchema = z.object({
  slug: z.string().trim().min(2).max(100).transform(slugify),
  category: z.string().trim().min(1).max(100),
  title: z.string().trim().min(3).max(180),
  hero: z.string().trim().min(1).max(120),
  metaDescription: z.string().trim().min(20).max(300),
  intro: z.string().trim().min(20).max(500),
  overviewJson: z.string().min(2),
  includesJson: z.string().min(2),
  processJson: z.string().min(2),
  aftercareJson: z.string().min(2),
  faqsJson: z.string().min(2),
  relatedSlugs: z.string().trim().max(300).default(''),
  displayOrder: z.coerce.number().int().min(0).max(1000).default(0),
});

/**
 * Validates one content block, naming the block and the offending entry so the
 * admin banner says "FAQ 2: question must be at least 5 characters" instead of
 * a wall of raw Zod JSON.
 */
function parseJsonBlock<S extends z.ZodType>(
  label: string,
  json: string,
  entrySchema: S
): { error: string } | { value: z.output<S>[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: `${label}s: the content could not be read. Please re-enter this block.` };
  }
  if (!Array.isArray(raw)) {
    return { error: `${label}s: expected a list of entries.` };
  }

  const result = z.array(entrySchema).safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const index = typeof issue?.path[0] === 'number' ? issue.path[0] + 1 : 1;
    const field = typeof issue?.path[1] === 'string' ? `${issue.path[1]} ` : '';
    return { error: `${label} ${index}: ${field}${issue?.message ?? 'is invalid'}` };
  }

  return { value: result.data };
}

function validateJsonArrays(
  input: z.infer<typeof contentSchema>
):
  | { error: string }
  | {
      overview: string[];
      includes: string[];
      process: { step: string; detail: string }[];
      aftercare: string[];
      faqs: { question: string; answer: string }[];
    } {
  const overview = parseJsonBlock('Overview paragraph', input.overviewJson, listEntrySchema);
  if ('error' in overview) return overview;

  const includes = parseJsonBlock("What's included item", input.includesJson, listEntrySchema);
  if ('error' in includes) return includes;

  const process = parseJsonBlock('Process step', input.processJson, processStepSchema);
  if ('error' in process) return process;

  const aftercare = parseJsonBlock('Aftercare tip', input.aftercareJson, listEntrySchema);
  if ('error' in aftercare) return aftercare;

  const faqs = parseJsonBlock('FAQ', input.faqsJson, faqSchema);
  if ('error' in faqs) return faqs;

  return {
    overview: overview.value,
    includes: includes.value,
    process: process.value,
    aftercare: aftercare.value,
    faqs: faqs.value,
  };
}

export type CategoryActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

export async function createCategoryContent(
  _prev: CategoryActionState,
  formData: FormData
): Promise<CategoryActionState> {
  await requireAdmin();
  const parsed = contentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  // min(2) is checked on the raw input, before slugify() strips it — so "頭髮"
  // or "--" passes validation and would otherwise save an empty slug.
  if (!parsed.data.slug) {
    return { status: 'error', message: 'Could not derive a slug — use letters or numbers.' };
  }

  const arrays = validateJsonArrays(parsed.data);
  if ('error' in arrays) return { status: 'error', message: arrays.error };

  const duplicateSlug = await prisma.serviceCategoryContent.findUnique({
    where: { slug: parsed.data.slug },
  });
  if (duplicateSlug) {
    return { status: 'error', message: `A category with slug "${parsed.data.slug}" already exists.` };
  }

  const duplicateCategory = await prisma.serviceCategoryContent.findUnique({
    where: { category: parsed.data.category },
  });
  if (duplicateCategory) {
    return {
      status: 'error',
      message: `A category content page for "${parsed.data.category}" already exists.`,
    };
  }

  const created = await prisma.serviceCategoryContent.create({
    data: {
      slug: parsed.data.slug,
      category: parsed.data.category,
      title: parsed.data.title,
      hero: parsed.data.hero,
      metaDescription: parsed.data.metaDescription,
      intro: parsed.data.intro,
      overviewJson: JSON.stringify(arrays.overview),
      includesJson: JSON.stringify(arrays.includes),
      processJson: JSON.stringify(arrays.process),
      aftercareJson: JSON.stringify(arrays.aftercare),
      faqsJson: JSON.stringify(arrays.faqs),
      relatedSlugs: parsed.data.relatedSlugs,
      displayOrder: parsed.data.displayOrder,
    },
  });

  revalidatePath('/services');
  revalidatePath(`/services/${created.slug}`);
  revalidatePath('/admin/categories');
  revalidatePath('/sitemap.xml');

  redirect(`/admin/categories/${created.id}/edit?saved=1`);
}

export async function updateCategoryContent(
  _prev: CategoryActionState,
  formData: FormData
): Promise<CategoryActionState> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) return { status: 'error', message: 'Missing id.' };

  const existing = await prisma.serviceCategoryContent.findUnique({ where: { id } });
  if (!existing) return { status: 'error', message: 'Content not found.' };

  const parsed = contentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  if (!parsed.data.slug) {
    return { status: 'error', message: 'Could not derive a slug — use letters or numbers.' };
  }

  const arrays = validateJsonArrays(parsed.data);
  if ('error' in arrays) return { status: 'error', message: arrays.error };

  if (parsed.data.slug !== existing.slug) {
    const dup = await prisma.serviceCategoryContent.findUnique({
      where: { slug: parsed.data.slug },
    });
    if (dup) {
      return { status: 'error', message: `Slug "${parsed.data.slug}" is already taken.` };
    }
  }

  if (parsed.data.category !== existing.category) {
    const dup = await prisma.serviceCategoryContent.findUnique({
      where: { category: parsed.data.category },
    });
    if (dup) {
      return {
        status: 'error',
        message: `Another row already maps to "${parsed.data.category}".`,
      };
    }
  }

  await prisma.serviceCategoryContent.update({
    where: { id },
    data: {
      slug: parsed.data.slug,
      category: parsed.data.category,
      title: parsed.data.title,
      hero: parsed.data.hero,
      metaDescription: parsed.data.metaDescription,
      intro: parsed.data.intro,
      overviewJson: JSON.stringify(arrays.overview),
      includesJson: JSON.stringify(arrays.includes),
      processJson: JSON.stringify(arrays.process),
      aftercareJson: JSON.stringify(arrays.aftercare),
      faqsJson: JSON.stringify(arrays.faqs),
      relatedSlugs: parsed.data.relatedSlugs,
      displayOrder: parsed.data.displayOrder,
    },
  });

  revalidatePath('/services');
  revalidatePath(`/services/${existing.slug}`);
  if (parsed.data.slug !== existing.slug) revalidatePath(`/services/${parsed.data.slug}`);
  revalidatePath('/admin/categories');
  revalidatePath('/sitemap.xml');

  return { status: 'success' };
}

/** Result shape shared by the per-row buttons on /admin/categories (see RowActionButton). */
export type CategoryRowActionState = { error?: string; success?: boolean };

export async function deleteCategoryContent(id: string): Promise<CategoryRowActionState> {
  await requireAdmin();
  if (!id) return { error: 'Missing id.' };

  const existing = await prisma.serviceCategoryContent.findUnique({ where: { id } });
  if (!existing) return { error: 'Category page not found — it may already have been deleted.' };

  try {
    await prisma.serviceCategoryContent.delete({ where: { id } });
  } catch (error) {
    console.error('deleteCategoryContent failed:', error);
    return { error: 'Failed to delete this category page. Please try again.' };
  }

  revalidatePath('/services');
  revalidatePath(`/services/${existing.slug}`);
  revalidatePath('/admin/categories');
  revalidatePath('/sitemap.xml');

  return { success: true };
}
