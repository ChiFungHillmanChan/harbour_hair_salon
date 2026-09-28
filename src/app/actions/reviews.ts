'use server';

import { z } from 'zod';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { getActionT } from '@/i18n/request';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';

// Messages are codes, translated into `reviews.errors.*` in the visitor's language.
const createReviewSchema = z.object({
  appointmentId: z.string().min(1, 'INVALID'),
  rating: z.coerce.number().int('RATING_REQUIRED').min(1, 'RATING_REQUIRED').max(5, 'RATING_REQUIRED'),
  comment: z
    .string()
    .trim()
    .max(1000, 'COMMENT_TOO_LONG')
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
  const t = await getActionT('reviews');

  const parsed = createReviewSchema.safeParse({
    appointmentId: formData.get('appointmentId'),
    rating: formData.get('rating'),
    comment: formData.get('comment'),
  });

  if (!parsed.success) {
    return { error: t.dynamic(`errors.${parsed.error.issues[0]?.message}`, undefined, t('errors.INVALID')) };
  }

  const { appointmentId, rating, comment } = parsed.data;

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, userId: true, status: true, date: true, review: { select: { id: true } } },
  });

  if (!appointment || appointment.userId !== session.userId) {
    return { error: t('errors.NOT_FOUND') };
  }

  if (appointment.review) {
    return { error: t('errors.ALREADY_REVIEWED') };
  }

  const now = new Date();
  if (appointment.status === 'CANCELLED') {
    return { error: t('errors.CANCELLED') };
  }
  if (appointment.date.getTime() > now.getTime()) {
    return { error: t('errors.NOT_YET') };
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
      return { error: t('errors.ALREADY_REVIEWED') };
    }
    throw error;
  }

  revalidateAllLocales(revalidatePath, '/appointments');
  revalidateAllLocales(revalidatePath, '/reviews');
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
  const t = await getActionT('reviews');
  if (session.role !== 'ADMIN') {
    return { error: t('errors.UNAUTHORIZED') };
  }

  const parsed = moderateSchema.safeParse({ reviewId, action });

  if (!parsed.success) {
    return { error: t('errors.INVALID_MODERATION') };
  }

  try {
    await prisma.review.update({
      where: { id: parsed.data.reviewId },
      data: { status: parsed.data.action === 'APPROVE' ? 'APPROVED' : 'REJECTED' },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return { error: t('errors.REVIEW_GONE') };
    }
    console.error('moderateReview failed:', error);
    return { error: t('errors.MODERATION_FAILED') };
  }

  revalidateAllLocales(revalidatePath, '/admin/reviews');
  revalidateAllLocales(revalidatePath, '/reviews');
  revalidateAllLocales(revalidatePath, '/');
  return { success: true };
}
