'use server';

import { z } from 'zod';
import { revalidatePath, updateTag } from 'next/cache';
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
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[0-9+()\s-]*$/, 'Phone can only contain digits, spaces and + - ( )')
    .default('07831 830898'),
  twitterHandle: z.string().trim().max(40).default(''),
  gscVerification: z.string().trim().max(200).default(''),
  googleBusinessUrl: urlOrEmpty.default(''),
  facebookUrl: urlOrEmpty.default(''),
  instagramUrl: urlOrEmpty.default(''),
  treatwellUrl: urlOrEmpty.default(''),
  freshaUrl: urlOrEmpty.default(''),
  booksyUrl: urlOrEmpty.default(''),
  heroEyebrow: z.string().trim().max(80).default('Leeds City Centre'),
  heroTitleLine1: z.string().trim().max(60).default('Expert Hair'),
  heroTitleLine2: z.string().trim().max(60).default('Styling'),
  heroSubtitle: z
    .string()
    .trim()
    .max(400)
    .default(
      'Tailored cuts, colours and grooming by Hong Kong trained stylists. Precision and artistry in every appointment.'
    ),
  // An unchecked checkbox is absent from FormData entirely, so this is parsed
  // from an explicit boolean the action computes rather than from the raw entry.
  bookingEnabled: z.boolean().default(false),
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

  const parsed = settingsSchema.safeParse({
    ...Object.fromEntries(formData),
    bookingEnabled: formData.get('bookingEnabled') === 'on',
  });
  if (!parsed.success) {
    // Name the offending field — otherwise the owner just sees a raw Zod message
    // (e.g. "Too big: expected string to have <=400 characters") over 14 boxes
    // with no idea which one to fix.
    const issue = parsed.error.issues[0];
    const FIELD_LABELS: Record<string, string> = {
      phone: 'Phone number',
      twitterHandle: 'Twitter handle',
      gscVerification: 'Google verification code',
      googleBusinessUrl: 'Google Business URL',
      facebookUrl: 'Facebook URL',
      instagramUrl: 'Instagram URL',
      treatwellUrl: 'Treatwell URL',
      freshaUrl: 'Fresha URL',
      booksyUrl: 'Booksy URL',
      heroEyebrow: 'Hero eyebrow text',
      heroTitleLine1: 'Hero title line 1',
      heroTitleLine2: 'Hero title line 2',
      heroSubtitle: 'Hero subtitle',
    };
    const label = FIELD_LABELS[String(issue?.path[0] ?? '')];
    const message = issue?.message ?? 'Invalid input';
    return { status: 'error', message: label ? `${label}: ${message}` : message };
  }

  await prisma.siteSettings.upsert({
    where: { id: 'singleton' },
    update: parsed.data,
    create: { id: 'singleton', ...parsed.data },
  });

  updateTag('site-settings');
  revalidatePath('/', 'layout');
  revalidatePath('/sitemap.xml');
  // Opening or closing booking must take effect immediately on the pages that
  // branch on it, not after the settings cache happens to expire.
  revalidatePath('/book');
  revalidatePath('/appointments');

  return { status: 'success' };
}
