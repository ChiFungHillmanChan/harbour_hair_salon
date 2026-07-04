'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') {
    throw new Error('Unauthorized');
  }
}

const serviceSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(200),
  description: z.string().trim().max(500).optional().transform((v) => v || null),
  price: z.coerce.number().nonnegative('Price cannot be negative').max(100000),
  duration: z.coerce.number().int().positive('Duration must be a positive number').max(1440),
  category: z.string().trim().min(1, 'Category is required').max(100),
  imageUrl: z.string().trim().max(500).optional().transform((v) => v || null),
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
  revalidatePath(`/services/${existing.category.toLowerCase()}`);
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
}
