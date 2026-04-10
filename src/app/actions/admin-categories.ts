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

const processStepSchema = z.object({
  step: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(800),
});

const faqSchema = z.object({
  question: z.string().trim().min(5).max(300),
  answer: z.string().trim().min(10).max(1200),
});

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
  try {
    const overview = z.array(z.string().min(1)).parse(JSON.parse(input.overviewJson));
    const includes = z.array(z.string().min(1)).parse(JSON.parse(input.includesJson));
    const process = z.array(processStepSchema).parse(JSON.parse(input.processJson));
    const aftercare = z.array(z.string().min(1)).parse(JSON.parse(input.aftercareJson));
    const faqs = z.array(faqSchema).parse(JSON.parse(input.faqsJson));
    return { overview, includes, process, aftercare, faqs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid content block';
    return { error: msg };
  }
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

export async function deleteCategoryContent(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) throw new Error('Missing id');

  const existing = await prisma.serviceCategoryContent.findUnique({ where: { id } });
  if (!existing) return;

  await prisma.serviceCategoryContent.delete({ where: { id } });

  revalidatePath('/services');
  revalidatePath(`/services/${existing.slug}`);
  revalidatePath('/admin/categories');
  revalidatePath('/sitemap.xml');
}
