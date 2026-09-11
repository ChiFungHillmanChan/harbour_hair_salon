'use server';

import prisma from '@/app/lib/prisma';
import { Prisma } from '@prisma/client';
import { verifySession } from '@/app/lib/session';
import { revalidatePath, updateTag } from 'next/cache';
import { hashPassword } from '@/app/lib/password';
import { z } from 'zod';
import { revalidateCategoryPages } from '@/app/actions/admin-services';
import { changedTreatwellSyncStatus, getTreatwellApiConfiguration } from '@/app/services/treatwell-api';
import { enqueueAppointmentNotification, dispatchAppointmentNotifications } from '@/app/services/notification-outbox-service';
import { checkCalendarBookingReadiness } from '@/app/services/integration-readiness';
import { assertAppointmentSlotAvailable, runSerializableWithRetry } from '@/app/services/booking-service';
import { BookingError } from '@/app/services/booking-errors';

// --- Validation Schemas ---

const discountCodeSchema = z.object({
  code: z.string().min(1, 'Code is required').toUpperCase(),
  type: z.enum(['PERCENTAGE', 'FIXED']),
  value: z.coerce.number().positive('Value must be positive'),
  maxUses: z.coerce.number().int().positive().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
}).refine(
  (data) => data.type !== 'PERCENTAGE' || data.value <= 100,
  { message: 'Percentage discount cannot exceed 100%', path: ['value'] }
);

const offerSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  discountType: z.enum(['PERCENTAGE', 'FIXED']),
  discountValue: z.coerce.number().positive('Value must be positive'),
  isGlobal: z.boolean().optional(),
}).refine(
  (data) => data.discountType !== 'PERCENTAGE' || data.discountValue <= 100,
  { message: 'Percentage discount cannot exceed 100%', path: ['discountValue'] }
);

// Same `{ error?, success? }` shape resetUserPassword below already returns —
// used here so OfferForm/OfferInlineEditor/DiscountForm can surface errors via
// useActionState instead of silently discarding them.
export type OfferActionState = { error?: string; success?: boolean };
export type DiscountActionState = { error?: string; success?: boolean };
export type AdminUserActionState = { error?: string; success?: boolean };

const adminUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Please enter a valid email').max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') {
    return { error: 'Unauthorized', session: null };
  }
  return { error: null, session };
}

// --- Discount Codes ---

export async function createDiscountCode(
  _prevState: DiscountActionState,
  formData: FormData
): Promise<DiscountActionState> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error };

  const parsed = discountCodeSchema.safeParse({
    code: formData.get('code'),
    type: formData.get('type'),
    value: formData.get('value'),
    maxUses: formData.get('maxUses') || null,
    expiresAt: formData.get('expiresAt') || null,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    await prisma.discountCode.create({
      data: {
        code: parsed.data.code,
        type: parsed.data.type,
        value: parsed.data.value,
        maxUses: parsed.data.maxUses ?? null,
        expiresAt: parsed.data.expiresAt ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { error: 'Discount code already exists' };
    }
    console.error('createDiscountCode failed:', error);
    return { error: 'Failed to create discount code. Please try again.' };
  }

  revalidatePath('/admin/discounts');
  return { success: true };
}

export async function deleteDiscountCode(id: string): Promise<DiscountActionState> {
  const { error } = await requireAdmin();
  if (error) return { error };

  try {
    // Check if any appointments use this code
    const usageCount = await prisma.appointment.count({
      where: { discountCodeId: id },
    });

    if (usageCount > 0) {
      // Deactivate instead of deleting
      await prisma.discountCode.update({
        where: { id },
        data: { isActive: false },
      });
    } else {
      await prisma.discountCode.delete({
        where: { id },
      });
    }
  } catch (error) {
    console.error('deleteDiscountCode failed:', error);
    return { error: 'Failed to delete discount code. Please try again.' };
  }

  revalidatePath('/admin/discounts');
  return { success: true };
}

/**
 * Flips a code between active and inactive. Deleting a code that has already
 * been redeemed only deactivates it (see above) and its `code` stays taken by
 * the unique index, so without this the salon could never bring a seasonal code
 * back — they had to invent a new one. Reversible, so no confirm prompt.
 */
export async function toggleDiscountCodeStatus(
  id: string,
  isActive: boolean
): Promise<DiscountActionState> {
  const { error } = await requireAdmin();
  if (error) return { error };

  try {
    await prisma.discountCode.update({
      where: { id },
      data: { isActive },
    });
  } catch (error) {
    console.error('toggleDiscountCodeStatus failed:', error);
    return {
      error: `Failed to ${isActive ? 'activate' : 'deactivate'} discount code. Please try again.`,
    };
  }

  revalidatePath('/admin/discounts');
  return { success: true };
}

// --- Offers ---

export async function createOffer(
  _prevState: OfferActionState,
  formData: FormData
): Promise<OfferActionState> {
  const { error } = await requireAdmin();
  if (error) return { error };

  const parsed = offerSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    discountType: formData.get('discountType'),
    discountValue: formData.get('discountValue'),
    isGlobal: formData.get('isGlobal') === 'on',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    await prisma.offer.create({
      data: {
        title: parsed.data.title,
        description: parsed.data.description || null,
        discountType: parsed.data.discountType,
        discountValue: parsed.data.discountValue,
        isActive: true,
        isGlobal: parsed.data.isGlobal ?? false,
      },
    });
  } catch (error) {
    console.error('createOffer failed:', error);
    return { error: 'Failed to create offer. Please try again.' };
  }

  revalidatePath('/admin/offers');
  updateTag('active-offers');
  revalidatePath('/offers');
  revalidatePath('/');
  revalidatePath('/services');
  await revalidateCategoryPages();

  return { success: true };
}

export async function updateOffer(
  _prevState: OfferActionState,
  formData: FormData
): Promise<OfferActionState> {
  const { error } = await requireAdmin();
  if (error) return { error };

  const id = formData.get('id');
  if (typeof id !== 'string' || !id) {
    return { error: 'Missing offer id.' };
  }

  const existing = await prisma.offer.findUnique({ where: { id } });
  if (!existing) return { error: 'Offer not found.' };

  const parsed = offerSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    discountType: formData.get('discountType'),
    discountValue: formData.get('discountValue'),
    isGlobal: formData.get('isGlobal') === 'on',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    await prisma.offer.update({
      where: { id },
      data: {
        title: parsed.data.title,
        description: parsed.data.description || null,
        discountType: parsed.data.discountType,
        discountValue: parsed.data.discountValue,
        isGlobal: parsed.data.isGlobal ?? false,
      },
    });
  } catch (error) {
    console.error('updateOffer failed:', error);
    return { error: 'Failed to update offer. Please try again.' };
  }

  revalidatePath('/admin/offers');
  updateTag('active-offers');
  revalidatePath('/offers');
  revalidatePath('/');
  revalidatePath('/services');
  await revalidateCategoryPages();

  return { success: true };
}

export async function toggleOfferStatus(id: string, isActive: boolean): Promise<OfferActionState> {
  const { error } = await requireAdmin();
  if (error) return { error };

  try {
    await prisma.offer.update({
      where: { id },
      data: { isActive },
    });
  } catch (error) {
    console.error('toggleOfferStatus failed:', error);
    return { error: 'Failed to update offer status. Please try again.' };
  }

  revalidatePath('/admin/offers');
  updateTag('active-offers');
  revalidatePath('/offers');
  revalidatePath('/');
  revalidatePath('/services');
  await revalidateCategoryPages();
  return { success: true };
}

export async function deleteOffer(id: string): Promise<OfferActionState> {
  const { error } = await requireAdmin();
  if (error) return { error };

  try {
    await prisma.offer.delete({
      where: { id },
    });
  } catch (error) {
    console.error('deleteOffer failed:', error);
    return { error: 'Failed to delete offer. Please try again.' };
  }

  revalidatePath('/admin/offers');
  updateTag('active-offers');
  revalidatePath('/offers');
  revalidatePath('/');
  revalidatePath('/services');
  await revalidateCategoryPages();
  return { success: true };
}

// --- Admin Users ---

export async function createAdminUser(
  _prevState: AdminUserActionState,
  formData: FormData
): Promise<AdminUserActionState> {
  const { error } = await requireAdmin();
  if (error) return { error };

  const parsed = adminUserSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const hashedPassword = await hashPassword(parsed.data.password);

  try {
    await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        password: hashedPassword,
        role: 'ADMIN',
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { error: 'Email already exists' };
    }
    console.error('createAdminUser failed:', error);
    return { error: 'Failed to create admin user. Please try again.' };
  }

  revalidatePath('/admin/users');
  return { success: true };
}

export async function deleteAdminUser(id: string): Promise<AdminUserActionState> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: error ?? 'Unauthorized' };

  if (id === session.userId) {
    return { error: 'You cannot delete your own account.' };
  }

  // Their appointments carry the booking history and hold a foreign key to the
  // user row, so the account has to stay. Say why — silently doing nothing left
  // the admin clicking Delete over and over.
  const appointmentCount = await prisma.appointment.count({
    where: { userId: id },
  });

  if (appointmentCount > 0) {
    return { error: `This admin has ${appointmentCount} appointment(s) and cannot be deleted.` };
  }

  try {
    await prisma.user.delete({
      where: { id },
    });
  } catch (error) {
    console.error('deleteAdminUser failed:', error);
    return { error: 'Failed to delete admin user. Please try again.' };
  }

  revalidatePath('/admin/users');
  return { success: true };
}

export async function promoteGoogleUserToAdmin(id: string) {
  const { error } = await requireAdmin();
  if (error) return;

  const user = await prisma.user.findFirst({
    where: {
      id,
      role: 'USER',
      oauthAccounts: { some: { provider: 'google' } },
    },
    select: { id: true },
  });

  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      role: 'ADMIN',
      // Force a fresh sign-in so middleware receives a session containing the
      // new role and the user cannot retain any stale pre-promotion session.
      sessionVersion: { increment: 1 },
    },
  });

  revalidatePath('/admin/users');
}

// Requests need explicit approval. Every transition checks the current row in
// the same transaction as its conditional write, so cancellation cannot race
// an approval and revive a slot that has already been released.
const ALLOWED_APPOINTMENT_STATUSES = ['CONFIRMED', 'COMPLETED', 'CANCELLED'] as const;
type AppointmentStatus = (typeof ALLOWED_APPOINTMENT_STATUSES)[number];

export async function updateAppointmentStatus(appointmentId: string, status: string) {
  const session = await verifySession();
  if (session.role !== 'ADMIN') {
    return { success: false, error: 'Not authorised' };
  }
  if (!ALLOWED_APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) {
    return { success: false, error: 'Invalid status' };
  }
  try {
    const { appointment, changed } = await runSerializableWithRetry(async (tx) => {
      const include = {
        user: { select: { email: true, name: true } },
        stylist: { select: { name: true, treatwellExternalId: true } },
        service: { select: { name: true, price: true, duration: true, treatwellExternalId: true } },
      } as const;
      const current = await tx.appointment.findUnique({ where: { id: appointmentId }, include });
      if (!current) throw new BookingError('Appointment not found');
      if (current.status === status) return { appointment: current, changed: false };
      if (status === 'CONFIRMED' && current.status !== 'PENDING') {
        throw new BookingError('Only pending requests can be confirmed');
      }
      if (current.status === 'CANCELLED') {
        throw new BookingError('A cancelled appointment cannot be reinstated — create a new booking.');
      }

      if (status === 'CONFIRMED') {
        const readiness = await checkCalendarBookingReadiness(tx);
        if (!readiness.ready) throw new BookingError('Calendar setup needs attention. Check Integrations before confirming this request.');
        // Imported bookings or opening hours may have changed since the request.
        await assertAppointmentSlotAvailable(tx, current, current.date);
      }

      const data: Prisma.AppointmentUpdateManyMutationInput = {
        status,
        notificationVersion: { increment: 1 },
      };
      if (status === 'CANCELLED') {
        const api = getTreatwellApiConfiguration();
        data.treatwellSyncStatus = changedTreatwellSyncStatus({
          apiReady: api.enabled && api.configured,
          treatwellBookingId: current.treatwellBookingId,
          stylistExternalId: current.stylist.treatwellExternalId,
          serviceExternalId: current.service.treatwellExternalId,
        });
        data.treatwellSyncError = null;
      }

      const result = await tx.appointment.updateMany({
        where: { id: appointmentId, status: current.status, date: current.date, updatedAt: current.updatedAt },
        data,
      });
      if (result.count !== 1) throw new BookingError('This appointment has changed. Please refresh and try again.');
      const updated = await tx.appointment.findUnique({ where: { id: appointmentId }, include });
      if (!updated) throw new BookingError('Appointment not found');
      if (status === 'CONFIRMED' || status === 'CANCELLED') await enqueueAppointmentNotification(tx, status === 'CONFIRMED' ? 'CONFIRMATION' : 'CANCELLATION', updated);
      return { appointment: updated, changed: true };
    });

    if (changed) await dispatchAppointmentNotifications(appointment.id);
  } catch (error) {
    return { success: false, error: error instanceof BookingError ? error.message : 'Could not update the appointment. Please try again.' };
  }
  revalidatePath('/admin');
  revalidatePath('/appointments');
  revalidatePath('/book');
  return { success: true };
}

export async function resetUserPassword(userId: string, newPassword: string) {
  const { error } = await requireAdmin();
  if (error) return { error };

  if (!newPassword || newPassword.length < 8) {
    return { error: 'Password must be at least 8 characters' };
  }

  if (newPassword.length > 128) {
    return { error: 'Password must be at most 128 characters' };
  }

  // Verify the target user is an admin (admins can only reset other admin passwords)
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!targetUser || targetUser.role !== 'ADMIN') {
    return { error: 'Can only reset passwords for admin users' };
  }

  const hashedPassword = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword, sessionVersion: { increment: 1 } },
  });

  revalidatePath('/admin/users');
  return { success: true };
}
