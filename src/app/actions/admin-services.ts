'use server';

import { z } from 'zod';
import { isCalendarColorKey } from '@/app/lib/calendar-colors';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { getAllCategoryContent } from '@/app/services/category-content-service';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') {
    throw new Error('Unauthorized');
  }
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
  for (const c of cats) revalidatePath(`/services/${c.slug}`);
}

const serviceSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(200),
  description: z.string().trim().max(500).optional().transform((v) => v || null),
  price: z.coerce.number().nonnegative('Price cannot be negative').max(100000),
  duration: z.coerce.number().int().positive('Duration must be a positive number').max(1440),
  category: z.string().trim().min(1, 'Category is required').max(100),
  imageUrl: z.string().trim().max(500).optional().transform((v) => v || null),
  treatwellExternalId: z.string().trim().max(200).optional().transform((v) => v || null),
  calendarColor: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isCalendarColorKey(v), 'Unknown calendar colour')
    .transform((v) => (v ? v : null)),
});

export type ServiceActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

export async function createService(
  _prev: ServiceActionState,
  formData: FormData
): Promise<ServiceActionState> {
  await requireAdmin();
  const parsed = serviceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const requiresPatchTest = formData.get('requiresPatchTest') === 'on';
  const isPatchTest = formData.get('isPatchTest') === 'on';
  const requiresConsultation = formData.get('requiresConsultation') === 'on';
  const isConsultation = formData.get('isConsultation') === 'on';

  const created = await prisma.service.create({ data: { ...parsed.data, requiresPatchTest, isPatchTest, requiresConsultation, isConsultation } });

  revalidatePath('/services');
  revalidatePath('/admin/services');
  revalidatePath('/');
  revalidatePath('/sitemap.xml');
  await revalidateCategoryPages();

  redirect(`/admin/services/${created.id}/edit?saved=1`);
}

export async function updateService(
  _prev: ServiceActionState,
  formData: FormData
): Promise<ServiceActionState> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) {
    return { status: 'error', message: 'Missing service id.' };
  }
  const existing = await prisma.service.findUnique({ where: { id } });
  if (!existing) return { status: 'error', message: 'Service not found.' };

  const parsed = serviceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const requiresPatchTest = formData.get('requiresPatchTest') === 'on';
  const isPatchTest = formData.get('isPatchTest') === 'on';
  const requiresConsultation = formData.get('requiresConsultation') === 'on';
  const isConsultation = formData.get('isConsultation') === 'on';

  await prisma.service.update({ where: { id }, data: { ...parsed.data, requiresPatchTest, isPatchTest, requiresConsultation, isConsultation } });

  revalidatePath('/services');
  await revalidateCategoryPages();
  revalidatePath('/admin/services');
  revalidatePath('/');
  revalidatePath('/sitemap.xml');

  return { status: 'success' };
}

export async function deleteService(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get('id');
  if (typeof id !== 'string' || !id) throw new Error('Missing service id');

  const appointmentCount = await prisma.appointment.count({ where: { serviceId: id } });
  if (appointmentCount > 0) {
    // Can't hard delete — would violate FK. The UI prevents this button from showing
    // in that case, but we still guard server-side.
    throw new Error(
      `Cannot delete: ${appointmentCount} appointment(s) reference this service. Archive it instead by clearing its description and renaming.`
    );
  }

  await prisma.service.delete({ where: { id } });

  revalidatePath('/services');
  revalidatePath('/admin/services');
  revalidatePath('/');
  revalidatePath('/sitemap.xml');
  await revalidateCategoryPages();
}
