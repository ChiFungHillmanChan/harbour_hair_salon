'use server';

import { z } from 'zod';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { isCalendarColorKey } from '@/app/lib/calendar-colors';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { getAllCategoryContent } from '@/app/services/category-content-service';
import { getActionLocale, getActionT } from '@/i18n/request';
import { localizeHref } from '@/i18n/paths';
import { ContentError, createPublished, deleteContent } from '@/app/services/content/drafts';
import { HAIR_LENGTHS, PRICE_NATURES, PRICE_TYPES, VAT_DISPLAYS } from '@/app/services/pricing/policy';
import { penceToDecimalString, toPence } from '@/app/services/pricing/money';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') {
    throw new Error('Unauthorized');
  }
  return session;
}

// Category detail pages live at /services/[slug] where slug is the (admin-set)
// ServiceCategoryContent.slug — NOT category.toLowerCase(). Revalidate every real
// slug so create/update/delete/category-move all propagate immediately.
//
// Exported (rather than kept private) so admin.ts's offer actions can share it:
// those category pages also render the global-offer banner, so an offer
// create/update/toggle/delete needs the same revalidation coverage. This is
// legal from a 'use server' file because the Next.js "server files may only
// export async functions" rule applies to exported *values*, and this helper
// already is an async function — no new shared module needed for one helper.
export async function revalidateCategoryPages() {
  // Every export of a 'use server' module is a callable action endpoint, so this
  // helper gets its own auth check rather than relying on its callers having
  // already run one. All current callers are admin-gated, making this a no-op
  // in practice — it just stops the endpoint being an unauthenticated way to
  // trigger DB reads and cache purges.
  await requireAdmin();
  const cats = await getAllCategoryContent();
  for (const c of cats) revalidateAllLocales(revalidatePath, `/services/${c.slug}`);
}

const checkbox = z.preprocess((value) => value === 'on' || value === 'true', z.boolean());
const optionalId = z.string().trim().max(64).optional().transform((v) => v || null);

/**
 * Operational settings: they take effect as soon as they are saved, in both
 * languages at once, because they are not wording. Whether an option is
 * listed or open for new bookings must never wait for a translation.
 * Customer-facing text and the price go through the bilingual editor instead
 * (actions/admin-content.ts).
 */
const settingsSchema = z.object({
  duration: z.coerce.number().int().positive('DURATION').max(1440, 'DURATION'),
  category: z.string().trim().min(1, 'CATEGORY').max(100, 'CATEGORY'),
  imageUrl: z.string().trim().max(500).optional().transform((v) => v || null),
  treatwellExternalId: z.string().trim().max(200).optional().transform((v) => v || null),
  calendarColor: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isCalendarColorKey(v), 'COLOUR')
    .transform((v) => (v ? v : null)),
  offeringId: optionalId,
  hairLength: z.union([z.literal(''), z.enum(HAIR_LENGTHS)]).optional().transform((v) => v || null),
  priceType: z.enum(PRICE_TYPES).default('STANDARD'),
  vatDisplay: z.enum(VAT_DISPLAYS).default('UNSPECIFIED'),
  priceNature: z.enum(PRICE_NATURES).default('LISTED'),
  isPublic: checkbox,
  isBookable: checkbox,
  durationConfirmed: checkbox,
  requiresPatchTest: checkbox,
  isPatchTest: checkbox,
  requiresConsultation: checkbox,
  isConsultation: checkbox,
}).refine((value) => !value.isBookable || value.durationConfirmed, { message: 'BOOKABLE_NEEDS_DURATION' });

export type ServiceActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

async function errorState(code: string): Promise<ServiceActionState> {
  const t = await getActionT('adminCatalog');
  return { status: 'error', message: t.dynamic(`serviceForm.errors.${code}`, undefined, t('serviceForm.errors.INVALID')) };
}

function parseSettings(formData: FormData) {
  return settingsSchema.safeParse(Object.fromEntries(formData));
}

async function assertOfferingExists(offeringId: string | null) {
  if (!offeringId) return true;
  return Boolean(await prisma.serviceOffering.findUnique({ where: { id: offeringId }, select: { id: true } }));
}

function refreshServicePages() {
  revalidateAllLocales(revalidatePath, '/services');
  revalidateAllLocales(revalidatePath, '/admin/services');
  revalidateAllLocales(revalidatePath, '/');
  revalidateAllLocales(revalidatePath, '/book');
  revalidatePath('/sitemap.xml');
}

export async function createService(
  _prev: ServiceActionState,
  formData: FormData
): Promise<ServiceActionState> {
  const session = await requireAdmin();
  const parsed = parseSettings(formData);
  if (!parsed.success) return errorState(parsed.error.issues[0]?.message ?? 'INVALID');
  if (!(await assertOfferingExists(parsed.data.offeringId))) return errorState('OFFERING');

  const priceText = String(formData.get('price') ?? '').trim();
  let pricePence: number;
  try {
    pricePence = toPence(priceText);
  } catch {
    return errorState('PRICE');
  }
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(priceText) || pricePence < 0) return errorState('PRICE');

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
      'SERVICE',
      { fields: contentFields, confirmedReviewed: formData.get('contentReviewed') === 'on', adminId: session.userId },
      (english) => tx.service.create({
        data: {
          ...parsed.data,
          name: String(english.name),
          description: typeof english.description === 'string' && english.description.trim() ? english.description : null,
          priceNote: typeof english.priceNote === 'string' && english.priceNote.trim() ? english.priceNote : null,
          price: penceToDecimalString(pricePence),
        },
        select: { id: true },
      }),
    ));
    createdId = created.id;
  } catch (error) {
    if (error instanceof ContentError) return errorState('CONTENT');
    throw error;
  }

  refreshServicePages();
  await revalidateCategoryPages();

  const locale = await getActionLocale();
  redirect(localizeHref(locale, `/admin/services/${createdId}/edit?saved=1`));
}

/** Save operational settings of an existing service (text and price are drafted separately). */
export async function updateService(
  _prev: ServiceActionState,
  formData: FormData
): Promise<ServiceActionState> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) {
    return errorState('MISSING_ID');
  }
  const existing = await prisma.service.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return errorState('NOT_FOUND');

  const parsed = parseSettings(formData);
  if (!parsed.success) return errorState(parsed.error.issues[0]?.message ?? 'INVALID');
  if (!(await assertOfferingExists(parsed.data.offeringId))) return errorState('OFFERING');

  await prisma.service.update({ where: { id }, data: parsed.data });

  refreshServicePages();
  await revalidateCategoryPages();

  return { status: 'success' };
}

export async function deleteService(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) throw new Error('Missing service id');

  const [appointmentCount, dependents] = await Promise.all([
    prisma.appointment.count({ where: { serviceId: id } }),
    prisma.service.count({ where: { surchargeBaseServiceId: id } }),
  ]);
  if (appointmentCount > 0 || dependents > 0) {
    // Can't hard delete — would violate FK / break a composite price. The UI
    // prevents this button from showing in that case, but we still guard
    // server-side. A service with history is retired instead (not public,
    // not bookable), which keeps every past appointment intact.
    const t = await getActionT('adminCatalog');
    throw new Error(t('serviceForm.errors.DELETE_IN_USE', { count: appointmentCount }));
  }

  await prisma.$transaction(async (tx) => {
    await deleteContent(tx, 'SERVICE', id);
    await tx.service.delete({ where: { id } });
  });

  refreshServicePages();
  await revalidateCategoryPages();
}
