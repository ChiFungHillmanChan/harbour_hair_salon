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

const faqSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Key is required')
    .max(80)
    .regex(/^[a-z0-9-:/]+$/, 'Key can only use lowercase letters, digits, dashes and colons'),
  question: z.string().trim().min(5).max(300),
  answer: z.string().trim().min(10).max(2000),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
});

export type FaqActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

function revalidatePublicPathsFor(key: string) {
  if (key === 'home') revalidatePath('/');
  else if (key === 'contact') revalidatePath('/contact');
  else if (key === 'services-master') revalidatePath('/services');
  else if (key.startsWith('category:')) {
    const slug = key.slice('category:'.length);
    revalidatePath(`/services/${slug}`);
  }
  revalidatePath('/admin/faqs');
}

export async function createFaq(
  _prev: FaqActionState,
  formData: FormData
): Promise<FaqActionState> {
  await requireAdmin();
  const parsed = faqSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  await prisma.faq.create({ data: parsed.data });
  revalidatePublicPathsFor(parsed.data.key);
  redirect(`/admin/faqs?key=${encodeURIComponent(parsed.data.key)}&saved=1`);
}

export async function updateFaq(
  _prev: FaqActionState,
  formData: FormData
): Promise<FaqActionState> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) return { status: 'error', message: 'Missing id' };

  const existing = await prisma.faq.findUnique({ where: { id } });
  if (!existing) return { status: 'error', message: 'FAQ not found.' };

  const parsed = faqSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  await prisma.faq.update({ where: { id }, data: parsed.data });

  if (existing.key !== parsed.data.key) revalidatePublicPathsFor(existing.key);
  revalidatePublicPathsFor(parsed.data.key);

  return { status: 'success' };
}

export async function deleteFaq(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) throw new Error('Missing id');

  const existing = await prisma.faq.findUnique({ where: { id } });
  if (!existing) return;

  await prisma.faq.delete({ where: { id } });
  revalidatePublicPathsFor(existing.key);
}
