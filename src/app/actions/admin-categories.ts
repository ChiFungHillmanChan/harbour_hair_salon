'use server';

import { z } from 'zod';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { getActionT, localizedPath } from '@/i18n/request';
import type { MessageParams } from '@/i18n/format';
import { ContentError, createPublished, deleteContent } from '@/app/services/content/drafts';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
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

/**
 * Page SETTINGS — saved immediately, in both languages at once. The page's
 * text (title, hero, description, intro and the overview / includes /
 * process / aftercare / FAQ blocks) is bilingual content: it is created with
 * both languages here, and edited afterwards as a draft that goes live on
 * publish (actions/admin-content.ts).
 */
const settingsSchema = z.object({
  slug: z.string('SLUG').trim().min(2, 'SLUG').max(100, 'SLUG').transform(slugify),
  category: z.string('CATEGORY').trim().min(1, 'CATEGORY').max(100, 'CATEGORY'),
  relatedSlugs: z.string().trim().max(300, 'RELATED').default(''),
  displayOrder: z.coerce.number('ORDER').int('ORDER').min(0, 'ORDER').max(1000, 'ORDER').default(0),
});

export type CategoryActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

async function message(code: string, params?: MessageParams): Promise<string> {
  const t = await getActionT('adminCatalog');
  return t.dynamic(`categories.errors.${code}`, params, t('categories.errors.INVALID'));
}

async function errorState(code: string, params?: MessageParams): Promise<CategoryActionState> {
  return { status: 'error', message: await message(code, params) };
}

function parseSettings(formData: FormData) {
  return settingsSchema.safeParse(Object.fromEntries(formData));
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const list = (value: unknown) => JSON.stringify(Array.isArray(value) ? value : []);

function refreshCategoryPages(...slugs: string[]) {
  revalidateAllLocales(revalidatePath, '/services');
  for (const slug of new Set(slugs)) revalidateAllLocales(revalidatePath, `/services/${slug}`);
  revalidateAllLocales(revalidatePath, '/admin/categories');
  revalidatePath('/sitemap.xml');
}

export async function createCategoryContent(
  _prev: CategoryActionState,
  formData: FormData
): Promise<CategoryActionState> {
  const session = await requireAdmin();
  const parsed = parseSettings(formData);
  if (!parsed.success) return errorState(parsed.error.issues[0]?.message ?? 'INVALID');
  // min(2) is checked on the raw input, before slugify() strips it — so "頭髮"
  // or "--" passes validation and would otherwise save an empty slug.
  if (!parsed.data.slug) return errorState('SLUG_EMPTY');

  const duplicateSlug = await prisma.serviceCategoryContent.findUnique({
    where: { slug: parsed.data.slug },
    select: { id: true },
  });
  if (duplicateSlug) return errorState('SLUG_TAKEN', { slug: parsed.data.slug });

  const duplicateCategory = await prisma.serviceCategoryContent.findUnique({
    where: { category: parsed.data.category },
    select: { id: true },
  });
  if (duplicateCategory) return errorState('CATEGORY_TAKEN', { category: parsed.data.category });

  let contentFields: unknown = null;
  try {
    contentFields = JSON.parse(String(formData.get('contentJson') ?? 'null'));
  } catch {
    return errorState('CONTENT');
  }

  let createdId: string;
  try {
    const created = await prisma.$transaction((tx) => createPublished(
      tx,
      'CATEGORY_CONTENT',
      { fields: contentFields, confirmedReviewed: formData.get('contentReviewed') === 'on', adminId: session.userId },
      (english) => tx.serviceCategoryContent.create({
        data: {
          ...parsed.data,
          title: text(english.title),
          hero: text(english.hero),
          metaDescription: text(english.metaDescription),
          intro: text(english.intro),
          overviewJson: list(english.overview),
          includesJson: list(english.includes),
          processJson: list(english.process),
          aftercareJson: list(english.aftercare),
          faqsJson: list(english.faqs),
        },
        select: { id: true },
      }),
    ));
    createdId = created.id;
  } catch (error) {
    if (error instanceof ContentError) return errorState('CONTENT');
    throw error;
  }

  refreshCategoryPages(parsed.data.slug);
  redirect(await localizedPath(`/admin/categories/${createdId}/edit?saved=1`));
}

/** Save the settings of an existing category page (its text is drafted separately). */
export async function updateCategoryContent(
  _prev: CategoryActionState,
  formData: FormData
): Promise<CategoryActionState> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) return errorState('MISSING_ID');

  const existing = await prisma.serviceCategoryContent.findUnique({ where: { id }, select: { slug: true, category: true } });
  if (!existing) return errorState('NOT_FOUND');

  const parsed = parseSettings(formData);
  if (!parsed.success) return errorState(parsed.error.issues[0]?.message ?? 'INVALID');
  if (!parsed.data.slug) return errorState('SLUG_EMPTY');

  if (parsed.data.slug !== existing.slug) {
    const dup = await prisma.serviceCategoryContent.findUnique({
      where: { slug: parsed.data.slug },
      select: { id: true },
    });
    if (dup) return errorState('SLUG_TAKEN', { slug: parsed.data.slug });
  }

  if (parsed.data.category !== existing.category) {
    const dup = await prisma.serviceCategoryContent.findUnique({
      where: { category: parsed.data.category },
      select: { id: true },
    });
    if (dup) return errorState('CATEGORY_TAKEN', { category: parsed.data.category });
  }

  await prisma.serviceCategoryContent.update({ where: { id }, data: parsed.data });

  refreshCategoryPages(existing.slug, parsed.data.slug);
  return { status: 'success' };
}

/** Result shape shared by the per-row buttons on /admin/categories (see RowActionButton). */
export type CategoryRowActionState = { error?: string; success?: boolean };

export async function deleteCategoryContent(id: string): Promise<CategoryRowActionState> {
  await requireAdmin();
  if (!id) return { error: await message('MISSING_ID') };

  const existing = await prisma.serviceCategoryContent.findUnique({ where: { id }, select: { slug: true } });
  if (!existing) return { error: await message('NOT_FOUND') };

  try {
    await prisma.$transaction(async (tx) => {
      await deleteContent(tx, 'CATEGORY_CONTENT', id);
      await tx.serviceCategoryContent.delete({ where: { id } });
    });
  } catch (error) {
    console.error('deleteCategoryContent failed:', error);
    return { error: await message('DELETE_FAILED') };
  }

  refreshCategoryPages(existing.slug);
  return { success: true };
}
