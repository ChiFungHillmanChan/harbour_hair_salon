'use server';

import { z } from 'zod';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { DEFAULT_LEAVE_COLOR_ID, DEFAULT_UNASSIGNED_COLOR_ID, isCalendarColorKey, isGoogleColorId } from '@/app/lib/calendar-colors';
import { parseGoogleAliases } from '@/app/lib/google-aliases';
import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { slugify } from '@/app/stylists/slug';
import { invalidateStylistIcalToken } from '@/app/services/stylist-ical-cache';
import { getActionT, localizedPath } from '@/i18n/request';
import type { MessageParams } from '@/i18n/format';
import { ContentError, createPublished, deleteContent } from '@/app/services/content/drafts';
import { AdminNoticeError } from '@/app/lib/admin-notice';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
  return session;
}

const calendarColorField = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || isCalendarColorKey(v), 'COLOUR')
  .transform((v) => (v ? v : null));

const googleColorField = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || isGoogleColorId(v), 'GOOGLE_COLOUR')
  .transform((v) => (v ? v : null));

const googleAliasesField = z
  .string()
  .max(200, 'GOOGLE_NAMES')
  .optional()
  .transform((v) => {
    const aliases = parseGoogleAliases(v);
    return aliases.length > 0 ? aliases.join(', ') : null;
  });

/**
 * Profile SETTINGS — saved immediately, in both languages at once. The name
 * is never translated. The profile text (role, bio, tagline, specialties,
 * languages, trained in, extended bio) is bilingual content: created with
 * both languages here, then edited as a draft that goes live on publish
 * (actions/admin-content.ts).
 */
const stylistSchema = z.object({
  calendarColor: calendarColorField,
  googleColorId: googleColorField,
  googleAliases: googleAliasesField,
  // Checkboxes: sent as "on" when ticked, left out of the form when not.
  takesWalkIns: z.string().optional().transform((v) => v === 'on'),
  showOnWebsite: z.string().optional().transform((v) => v === 'on'),
  name: z.string('NAME').trim().min(2, 'NAME').max(100, 'NAME'),
  slug: z
    .string()
    .trim()
    .max(80, 'SLUG')
    .optional()
    .transform((v) => (v ? slugify(v) : '')),
  imageUrl: z
    .string()
    .trim()
    .max(500, 'IMAGE')
    .optional()
    .transform((v) => v || null),
  yearsExperience: z.coerce.number('YEARS').int('YEARS').min(0, 'YEARS').max(80, 'YEARS').optional(),
  treatwellExternalId: z
    .string()
    .trim()
    .max(200, 'TREATWELL_ID')
    .optional()
    .transform((v) => (v ? v : null)),
});

export type StylistActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

async function message(code: string, params?: MessageParams): Promise<string> {
  const t = await getActionT('adminContent');
  return t.dynamic(`stylists.errors.${code}`, params, t('stylists.errors.INVALID'));
}

async function errorState(code: string, params?: MessageParams): Promise<StylistActionState> {
  return { status: 'error', message: await message(code, params) };
}

function parseSettings(formData: FormData) {
  // An empty number box submits "", which would coerce to 0 years.
  const entries = Object.fromEntries(formData);
  if (entries.yearsExperience === '') delete entries.yearsExperience;
  return stylistSchema.safeParse(entries);
}

/**
 * A Google colour belongs to one active stylist (spec §3), and never to the
 * no-stylist or leave colour: an event in it would be read as that stylist's.
 */
async function googleColourProblem(colorId: string | null, stylistId: string | null): Promise<StylistActionState | null> {
  if (!colorId) return null;
  const holder = await prisma.stylist.findFirst({
    where: { isActive: true, googleColorId: colorId, ...(stylistId ? { id: { not: stylistId } } : {}) },
    select: { name: true },
  });
  if (holder) return errorState('GOOGLE_COLOUR_TAKEN', { stylist: holder.name });
  const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { googleUnassignedColorId: true, googleLeaveColorId: true } });
  const reserved = [settings?.googleUnassignedColorId ?? DEFAULT_UNASSIGNED_COLOR_ID, settings?.googleLeaveColorId ?? DEFAULT_LEAVE_COLOR_ID];
  return reserved.includes(colorId) ? errorState('GOOGLE_COLOUR_RESERVED') : null;
}

function refreshStylistPages(...slugs: (string | null)[]) {
  revalidateAllLocales(revalidatePath, '/stylists');
  for (const slug of new Set(slugs)) if (slug) revalidateAllLocales(revalidatePath, `/stylists/${slug}`);
  revalidateAllLocales(revalidatePath, '/');
  revalidateAllLocales(revalidatePath, '/admin/stylists');
  revalidatePath('/sitemap.xml');
}

const optionalText = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
const list = (value: unknown) => JSON.stringify(Array.isArray(value) ? value : []);

export async function createStylist(
  _prev: StylistActionState,
  formData: FormData
): Promise<StylistActionState> {
  const session = await requireAdmin();
  const parsed = parseSettings(formData);
  if (!parsed.success) return errorState(parsed.error.issues[0]?.message ?? 'INVALID');

  const slug = parsed.data.slug || slugify(parsed.data.name);
  if (!slug) return errorState('SLUG_EMPTY');
  const duplicate = await prisma.stylist.findUnique({ where: { slug }, select: { id: true } });
  if (duplicate) return errorState('SLUG_TAKEN', { slug });
  const colourProblem = await googleColourProblem(parsed.data.googleColorId, null);
  if (colourProblem) return colourProblem;

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
      'STYLIST',
      { fields: contentFields, confirmedReviewed: formData.get('contentReviewed') === 'on', adminId: session.userId },
      (english) => tx.stylist.create({
        select: { id: true },
        data: {
          name: parsed.data.name,
          imageUrl: parsed.data.imageUrl,
          slug,
          yearsExperience: parsed.data.yearsExperience ?? null,
          treatwellExternalId: parsed.data.treatwellExternalId,
          calendarColor: parsed.data.calendarColor,
          googleColorId: parsed.data.googleColorId,
          googleAliases: parsed.data.googleAliases,
          takesWalkIns: parsed.data.takesWalkIns,
          showOnWebsite: parsed.data.showOnWebsite,
          role: typeof english.role === 'string' ? english.role : '',
          bio: optionalText(english.bio),
          tagline: optionalText(english.tagline),
          trainedIn: optionalText(english.trainedIn),
          specialtiesJson: list(english.specialties),
          languagesJson: list(english.languages),
          extendedBioJson: list(english.extendedBio),
        },
      }),
    ));
    createdId = created.id;
  } catch (error) {
    if (error instanceof ContentError) return errorState('CONTENT');
    throw error;
  }

  refreshStylistPages(slug);
  redirect(await localizedPath(`/admin/stylists/${createdId}/edit?saved=1`));
}

/** Save the settings of an existing stylist (their profile text is drafted separately). */
export async function updateStylist(
  _prev: StylistActionState,
  formData: FormData
): Promise<StylistActionState> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) return errorState('MISSING_ID');

  const existing = await prisma.stylist.findUnique({ where: { id }, select: { slug: true } });
  if (!existing) return errorState('NOT_FOUND');

  const parsed = parseSettings(formData);
  if (!parsed.success) return errorState(parsed.error.issues[0]?.message ?? 'INVALID');

  const slug = parsed.data.slug || slugify(parsed.data.name);
  if (!slug) return errorState('SLUG_EMPTY');
  if (slug !== existing.slug) {
    const dup = await prisma.stylist.findUnique({ where: { slug }, select: { id: true } });
    if (dup) return errorState('SLUG_TAKEN', { slug });
  }
  const colourProblem = await googleColourProblem(parsed.data.googleColorId, id);
  if (colourProblem) return colourProblem;

  await prisma.stylist.update({
    where: { id },
    select: { id: true },
    data: {
      name: parsed.data.name,
      imageUrl: parsed.data.imageUrl,
      slug,
      yearsExperience: parsed.data.yearsExperience ?? null,
      treatwellExternalId: parsed.data.treatwellExternalId,
      calendarColor: parsed.data.calendarColor,
      googleColorId: parsed.data.googleColorId,
      googleAliases: parsed.data.googleAliases,
      takesWalkIns: parsed.data.takesWalkIns,
      showOnWebsite: parsed.data.showOnWebsite,
    },
  });

  refreshStylistPages(existing.slug, slug);
  return { status: 'success' };
}

const STYLIST_SWITCHES = ['showOnWebsite', 'takesWalkIns'] as const;
export type StylistSwitch = (typeof STYLIST_SWITCHES)[number];

/**
 * Admin → Stylists list: turn one of a stylist's two switches on or off —
 * "Show on website" (the public Stylists pages and online booking) or "Takes
 * walk-ins" (a chair for the diary's red bookings). Nothing else.
 */
export async function setStylistSwitch(id: string, name: StylistSwitch, on: boolean): Promise<{ error?: string; success?: boolean }> {
  await requireAdmin();
  if (!STYLIST_SWITCHES.includes(name) || typeof on !== 'boolean') return { error: await message('INVALID') };
  const existing = await prisma.stylist.findUnique({ where: { id }, select: { slug: true, name: true } });
  if (!existing) return { error: await message('NOT_FOUND') };
  await prisma.stylist.update({ where: { id }, select: { id: true }, data: { [name]: on } });
  // A profile from before slugs were stored is served at its name's slug.
  refreshStylistPages(existing.slug ?? slugify(existing.name));
  return { success: true };
}

export async function deleteStylist(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) throw new AdminNoticeError(await message('MISSING_ID'));

  // Read the slug while the row still exists: /stylists/[slug] is ISR
  // (revalidate 3600), so without purging that exact path the deleted stylist's
  // profile stays live and bookable for up to an hour.
  const existing = await prisma.stylist.findUnique({ where: { id }, select: { slug: true } });
  if (!existing) throw new AdminNoticeError(await message('NOT_FOUND'));

  const appointmentCount = await prisma.appointment.count({ where: { stylistId: id } });
  if (appointmentCount > 0) {
    throw new AdminNoticeError(await message('DELETE_IN_USE', { count: appointmentCount }));
  }

  await prisma.$transaction(async (tx) => {
    await deleteContent(tx, 'STYLIST', id);
    await tx.stylist.delete({ where: { id }, select: { id: true } });
  });
  updateTag('calendar-sync-hours');
  // The token cache has no short timer, so a deleted stylist's feed URL would
  // otherwise keep answering until the week-long safety net expired.
  invalidateStylistIcalToken();

  refreshStylistPages(existing.slug);
}
