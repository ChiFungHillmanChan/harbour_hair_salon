'use server';

import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { hashPassword } from '@/app/lib/password';

// --- Discount Codes ---

export async function createDiscountCode(formData: FormData) {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');

  const code = formData.get('code') as string;
  const type = formData.get('type') as string; // 'PERCENTAGE' | 'FIXED'
  const value = parseFloat(formData.get('value') as string);
  const maxUses = formData.get('maxUses') ? parseInt(formData.get('maxUses') as string) : null;
  const expiresAt = formData.get('expiresAt') ? new Date(formData.get('expiresAt') as string) : null;

  await prisma.discountCode.create({
    data: {
      code,
      type,
      value,
      maxUses,
      expiresAt,
    },
  });

  revalidatePath('/admin/discounts');
}

export async function deleteDiscountCode(id: string) {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');

  await prisma.discountCode.delete({
    where: { id },
  });

  revalidatePath('/admin/discounts');
}

// --- Offers ---

export async function createOffer(formData: FormData) {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');

  const title = formData.get('title') as string;
  const description = formData.get('description') as string;
  const discountType = formData.get('discountType') as string;
  const discountValue = parseFloat(formData.get('discountValue') as string);
  const isGlobal = formData.get('isGlobal') === 'on';
  
  await prisma.offer.create({
    data: {
      title,
      description,
      discountType,
      discountValue,
      isActive: true,
      isGlobal,
    },
  });

  revalidatePath('/admin/offers');
  revalidatePath('/offers'); // Public page
  revalidatePath('/'); // Home page
  revalidatePath('/services'); // Services page
}

export async function toggleOfferStatus(id: string, isActive: boolean) {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');

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
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');

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
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');

  const name = formData.get('name') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  const hashedPassword = await hashPassword(password);

  try {
    await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: 'ADMIN',
      },
    });
  } catch {
    return { error: 'Email already exists' };
  }

  revalidatePath('/admin/users');
}

export async function deleteAdminUser(id: string) {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');

  // Prevent self-deletion
  if (id === session.userId) {
    throw new Error('Cannot delete yourself');
  }

  await prisma.user.delete({
    where: { id },
  });

  revalidatePath('/admin/users');
}

export async function resetUserPassword(userId: string, newPassword: string) {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');

  if (!newPassword || newPassword.length < 6) {
    return { error: 'Password must be at least 6 characters' };
  }

  const hashedPassword = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });

  revalidatePath('/admin/users');
  return { success: true };
}
