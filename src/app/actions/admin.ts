'use server';

import prisma from '@/app/lib/prisma';
import { Prisma } from '@prisma/client';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { hashPassword } from '@/app/lib/password';
import { z } from 'zod';

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

export async function createDiscountCode(formData: FormData) {
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
}

export async function deleteDiscountCode(id: string) {
  const { error } = await requireAdmin();
  if (error) return;

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

  revalidatePath('/admin/discounts');
}

// --- Offers ---

export async function createOffer(formData: FormData) {
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

  revalidatePath('/admin/offers');
  revalidatePath('/offers');
  revalidatePath('/');
  revalidatePath('/services');
}

export async function toggleOfferStatus(id: string, isActive: boolean) {
  const { error } = await requireAdmin();
  if (error) return;

  await prisma.offer.update({
    where: { id },
    data: { isActive },
  });

  revalidatePath('/admin/offers');
  revalidatePath('/offers');
  revalidatePath('/');
  revalidatePath('/services');
}

export async function deleteOffer(id: string) {
  const { error } = await requireAdmin();
  if (error) return;

  await prisma.offer.delete({
    where: { id },
  });

  revalidatePath('/admin/offers');
  revalidatePath('/offers');
  revalidatePath('/');
  revalidatePath('/services');
}

// --- Admin Users ---

export async function createAdminUser(formData: FormData) {
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
}

export async function deleteAdminUser(id: string) {
  const { error, session } = await requireAdmin();
  if (error || !session) return;

  if (id === session.userId) return;

  // Check if user has appointments — skip deletion if so
  const appointmentCount = await prisma.appointment.count({
    where: { userId: id },
  });

  if (appointmentCount > 0) return;

  await prisma.user.delete({
    where: { id },
  });

  revalidatePath('/admin/users');
}

// CONFIRMED intentionally excluded: no UI path re-confirms an appointment,
// and doing so here would bypass the in-transaction double-booking conflict
// check that rescheduleAppointment uses. If un-confirm is ever needed, add
// it back together with that same conflict check.
const ALLOWED_APPOINTMENT_STATUSES = ['COMPLETED', 'CANCELLED'] as const;
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
    await prisma.appointment.update({ where: { id: appointmentId }, data: { status } });
  } catch {
    return { success: false, error: 'Appointment not found' };
  }
  revalidatePath('/admin');
  revalidatePath('/appointments');
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
