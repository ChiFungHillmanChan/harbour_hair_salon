'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
}

const urlOrEmpty = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https?:\/\//.test(v), {
    message: 'URL must start with http:// or https://',
  });

const settingsSchema = z.object({
  phone: z.string().trim().max(40).default('07831 830898'),
  twitterHandle: z.string().trim().max(40).default(''),
  gscVerification: z.string().trim().max(200).default(''),
  googleBusinessUrl: urlOrEmpty.default(''),
  facebookUrl: urlOrEmpty.default(''),
  instagramUrl: urlOrEmpty.default(''),
  treatwellUrl: urlOrEmpty.default(''),
  freshaUrl: urlOrEmpty.default(''),
  booksyUrl: urlOrEmpty.default(''),
});

export type SettingsActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

export async function updateSiteSettings(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  await requireAdmin();

  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  await prisma.siteSettings.upsert({
    where: { id: 'singleton' },
    update: parsed.data,
    create: { id: 'singleton', ...parsed.data },
  });

  revalidatePath('/', 'layout');
  revalidatePath('/sitemap.xml');

  return { status: 'success' };
}
