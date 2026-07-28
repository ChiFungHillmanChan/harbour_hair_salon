'use server';

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';

const createReviewSchema = z.object({
  appointmentId: z.string().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z
    .string()
    .trim()
    .max(1000, 'Please keep your comment under 1000 characters.')
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

type ActionState =
  | { error?: undefined; success?: undefined }
  | { error: string; success?: undefined }
  | { error?: undefined; success: true };

export async function createReview(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await verifySession();

  const parsed = createReviewSchema.safeParse({
    appointmentId: formData.get('appointmentId'),
    rating: formData.get('rating'),
    comment: formData.get('comment'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid review data.' };
  }

  const { appointmentId, rating, comment } = parsed.data;

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, userId: true, status: true, date: true, review: { select: { id: true } } },
  });

  if (!appointment || appointment.userId !== session.userId) {
    return { error: 'Appointment not found.' };
  }

  if (appointment.review) {
    return { error: 'You have already left a review for this appointment.' };
  }

  const now = new Date();
  if (appointment.status === 'CANCELLED') {
    return { error: 'You can only review appointments you actually attended.' };
  }
  if (appointment.date.getTime() > now.getTime()) {
    return { error: 'You can only review appointments after they have taken place.' };
  }

  try {
    await prisma.review.create({
      data: {
        rating,
        comment,
        status: 'PENDING',
        userId: session.userId,
        appointmentId,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { error: 'You have already left a review for this appointment.' };
    }
    throw error;
  }

  revalidatePath('/appointments');
  revalidatePath('/reviews');
  return { success: true };
}

const moderateSchema = z.object({
  reviewId: z.string().min(1),
  action: z.enum(['APPROVE', 'REJECT']),
});

export type ModerationActionState = { error?: string; success?: boolean };

/**
 * Set a review's published state. Bound-argument shape so the admin rows can
 * drive it through RowActionButton and surface a failure (expired session,
 * deleted review) next to the review instead of throwing.
 *
 * There is deliberately no guard on the CURRENT status: moderation runs both
 * ways, so REJECT doubles as "unpublish" for a review that was already
 * approved, and APPROVE re-publishes one that was rejected by mistake.
 */
export async function moderateReview(
  reviewId: string,
  action: 'APPROVE' | 'REJECT'
): Promise<ModerationActionState> {
  const session = await verifySession();
  if (session.role !== 'ADMIN') {
    return { error: 'Unauthorized' };
  }

  const parsed = moderateSchema.safeParse({ reviewId, action });

  if (!parsed.success) {
    return { error: 'Invalid moderation payload' };
  }

  try {
    await prisma.review.update({
      where: { id: parsed.data.reviewId },
      data: { status: parsed.data.action === 'APPROVE' ? 'APPROVED' : 'REJECTED' },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return { error: 'That review no longer exists.' };
    }
    console.error('moderateReview failed:', error);
    return { error: 'Failed to update this review. Please try again.' };
  }

  revalidatePath('/admin/reviews');
  revalidatePath('/reviews');
  revalidatePath('/');
  return { success: true };
}
