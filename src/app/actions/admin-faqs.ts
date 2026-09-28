'use server';

import { z } from 'zod';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { getActionT, localizedPath } from '@/i18n/request';
import { ContentError, createPublished, deleteContent } from '@/app/services/content/drafts';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
  return session;
}

/**
 * Where an FAQ appears and in what order — saved immediately, in both
 * languages. The question and answer are bilingual content: created with
 * both languages here, then edited as a draft that goes live on publish
 * (actions/admin-content.ts).
 */
const placementSchema = z.object({
  key: z
    .string('KEY_REQUIRED')
    .trim()
    .min(1, 'KEY_REQUIRED')
    .max(80, 'KEY_LENGTH')
    .regex(/^[a-z0-9-:/]+$/, 'KEY_FORMAT'),
  sortOrder: z.coerce.number('SORT_ORDER').int('SORT_ORDER').min(0, 'SORT_ORDER').max(10000, 'SORT_ORDER').default(0),
});

export type FaqActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

async function errorState(code: string): Promise<FaqActionState> {
  const t = await getActionT('adminContent');
  return { status: 'error', message: t.dynamic(`faqs.errors.${code}`, undefined, t('faqs.errors.INVALID')) };
}

function revalidatePublicPathsFor(key: string) {
  if (key === 'home') revalidateAllLocales(revalidatePath, '/');
  else if (key === 'contact') revalidateAllLocales(revalidatePath, '/contact');
  else if (key === 'services-master') revalidateAllLocales(revalidatePath, '/services');
  else if (key.startsWith('category:')) {
    const slug = key.slice('category:'.length);
    revalidateAllLocales(revalidatePath, `/services/${slug}`);
  }
  revalidateAllLocales(revalidatePath, '/admin/faqs');
}

export async function createFaq(
  _prev: FaqActionState,
  formData: FormData
): Promise<FaqActionState> {
  const session = await requireAdmin();
  const parsed = placementSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState(parsed.error.issues[0]?.message ?? 'INVALID');

  let contentFields: unknown = null;
  try {
    contentFields = JSON.parse(String(formData.get('contentJson') ?? 'null'));
  } catch {
    return errorState('CONTENT');
  }

  try {
    await prisma.$transaction((tx) => createPublished(
      tx,
      'FAQ',
      { fields: contentFields, confirmedReviewed: formData.get('contentReviewed') === 'on', adminId: session.userId },
      (english) => tx.faq.create({
        data: {
          ...parsed.data,
          question: typeof english.question === 'string' ? english.question : '',
          answer: typeof english.answer === 'string' ? english.answer : '',
        },
        select: { id: true },
      }),
    ));
  } catch (error) {
    if (error instanceof ContentError) return errorState('CONTENT');
    throw error;
  }

  revalidatePublicPathsFor(parsed.data.key);
  redirect(await localizedPath(`/admin/faqs?key=${encodeURIComponent(parsed.data.key)}&saved=1`));
}

/** Move an FAQ to another page or position (its wording is drafted separately). */
export async function updateFaq(
  _prev: FaqActionState,
  formData: FormData
): Promise<FaqActionState> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) return errorState('MISSING_ID');

  const existing = await prisma.faq.findUnique({ where: { id }, select: { key: true } });
  if (!existing) return errorState('NOT_FOUND');

  const parsed = placementSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState(parsed.error.issues[0]?.message ?? 'INVALID');

  await prisma.faq.update({ where: { id }, data: parsed.data });

  if (existing.key !== parsed.data.key) revalidatePublicPathsFor(existing.key);
  revalidatePublicPathsFor(parsed.data.key);

  return { status: 'success' };
}

export async function deleteFaq(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) throw new Error('Missing id');

  const existing = await prisma.faq.findUnique({ where: { id }, select: { key: true } });
  if (!existing) return;

  await prisma.$transaction(async (tx) => {
    await deleteContent(tx, 'FAQ', id);
    await tx.faq.delete({ where: { id } });
  });
  revalidatePublicPathsFor(existing.key);
}
