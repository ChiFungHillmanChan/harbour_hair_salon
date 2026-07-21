'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { slugify } from '@/app/stylists/slug';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
}

const stylistSchema = z.object({
  name: z.string().trim().min(2).max(100),
  role: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? slugify(v) : '')),
  bio: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
  imageUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
  tagline: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null),
  specialtiesJson: z.string().default('[]'),
  languagesJson: z.string().default('[]'),
  yearsExperience: z.coerce.number().int().min(0).max(80).optional(),
  trainedIn: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || null),
  extendedBioJson: z.string().default('[]'),
  treatwellIcalUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https?:\/\/.+/i.test(v), {
      message: 'Treatwell iCal URL must be a valid http(s) URL.',
    }),
  treatwellExternalId: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : null)),
});

export type StylistActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

function validateJson(input: z.infer<typeof stylistSchema>):
  | { error: string }
  | { specialties: string[]; languages: string[]; extendedBio: string[] } {
  try {
    const specialties = z.array(z.string().min(1)).parse(JSON.parse(input.specialtiesJson));
    const languages = z.array(z.string().min(1)).parse(JSON.parse(input.languagesJson));
    const extendedBio = z.array(z.string().min(1)).parse(JSON.parse(input.extendedBioJson));
    return { specialties, languages, extendedBio };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Invalid content block' };
  }
}

export async function createStylist(
  _prev: StylistActionState,
  formData: FormData
): Promise<StylistActionState> {
  await requireAdmin();
  const parsed = stylistSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const arrays = validateJson(parsed.data);
  if ('error' in arrays) return { status: 'error', message: arrays.error };

  const slug = parsed.data.slug || slugify(parsed.data.name);
  const duplicate = await prisma.stylist.findUnique({ where: { slug }, select: { id: true } });
  if (duplicate) {
    return { status: 'error', message: `A stylist with slug "${slug}" already exists.` };
  }

  const created = await prisma.stylist.create({
    select: { id: true },
    data: {
      name: parsed.data.name,
      role: parsed.data.role,
      bio: parsed.data.bio,
      imageUrl: parsed.data.imageUrl,
      slug,
      tagline: parsed.data.tagline,
      specialtiesJson: JSON.stringify(arrays.specialties),
      languagesJson: JSON.stringify(arrays.languages),
      yearsExperience: parsed.data.yearsExperience ?? null,
      trainedIn: parsed.data.trainedIn,
      extendedBioJson: JSON.stringify(arrays.extendedBio),
      treatwellIcalUrl: parsed.data.treatwellIcalUrl,
      treatwellExternalId: parsed.data.treatwellExternalId,
    },
  });

  revalidatePath('/stylists');
  revalidatePath(`/stylists/${slug}`);
  revalidatePath('/');
  revalidatePath('/admin/stylists');
  revalidatePath('/sitemap.xml');

  redirect(`/admin/stylists/${created.id}/edit?saved=1`);
}

export async function updateStylist(
  _prev: StylistActionState,
  formData: FormData
): Promise<StylistActionState> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) return { status: 'error', message: 'Missing id.' };

  const existing = await prisma.stylist.findUnique({ where: { id }, select: { slug: true } });
  if (!existing) return { status: 'error', message: 'Stylist not found.' };

  const parsed = stylistSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const arrays = validateJson(parsed.data);
  if ('error' in arrays) return { status: 'error', message: arrays.error };

  const slug = parsed.data.slug || slugify(parsed.data.name);
  if (slug !== existing.slug) {
    const dup = await prisma.stylist.findUnique({ where: { slug }, select: { id: true } });
    if (dup) return { status: 'error', message: `Slug "${slug}" already taken.` };
  }

  await prisma.stylist.update({
    where: { id },
    select: { id: true },
    data: {
      name: parsed.data.name,
      role: parsed.data.role,
      bio: parsed.data.bio,
      imageUrl: parsed.data.imageUrl,
      slug,
      tagline: parsed.data.tagline,
      specialtiesJson: JSON.stringify(arrays.specialties),
      languagesJson: JSON.stringify(arrays.languages),
      yearsExperience: parsed.data.yearsExperience ?? null,
      trainedIn: parsed.data.trainedIn,
      extendedBioJson: JSON.stringify(arrays.extendedBio),
      treatwellIcalUrl: parsed.data.treatwellIcalUrl,
      treatwellExternalId: parsed.data.treatwellExternalId,
    },
  });

  revalidatePath('/stylists');
  if (existing.slug) revalidatePath(`/stylists/${existing.slug}`);
  if (slug !== existing.slug) revalidatePath(`/stylists/${slug}`);
  revalidatePath('/');
  revalidatePath('/admin/stylists');
  revalidatePath('/sitemap.xml');

  return { status: 'success' };
}

export async function deleteStylist(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) throw new Error('Missing id');

  const appointmentCount = await prisma.appointment.count({ where: { stylistId: id } });
  if (appointmentCount > 0) {
    throw new Error(
      `Cannot delete — this stylist has ${appointmentCount} appointment(s). Remove or reassign them first.`
    );
  }

  await prisma.stylist.delete({ where: { id }, select: { id: true } });

  revalidatePath('/stylists');
  revalidatePath('/');
  revalidatePath('/admin/stylists');
  revalidatePath('/sitemap.xml');
}
