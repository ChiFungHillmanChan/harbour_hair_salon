import 'server-only';
import { requireAdmin } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';

export type AggregateRating = {
  count: number;
  average: number; // 0-5, rounded to 1 decimal
};

export async function getAggregateRating(): Promise<AggregateRating> {
  const agg = await prisma.review.aggregate({
    where: { status: 'APPROVED' },
    _count: { _all: true },
    _avg: { rating: true },
  });

  const count = agg._count._all;
  const average = agg._avg.rating ?? 0;

  return {
    count,
    average: Math.round(average * 10) / 10,
  };
}

export async function getApprovedReviews(limit = 30) {
  return prisma.review.findMany({
    where: { status: 'APPROVED' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true, rating: true, comment: true, createdAt: true,
      user: { select: { name: true } },
      appointment: {
        select: {
          service: { select: { name: true } },
          stylist: { select: { name: true } },
        },
      },
    },
  });
}

/** Review.status is a plain String column — these are its three valid values. */
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * Reviews for the admin moderation screen, including the client's email so an
 * admin can tell two same-named clients apart. Takes the status so the screen
 * can also list what has already been approved or rejected: moderation is not
 * one-way, and an approved review has to be reachable to be pulled back down.
 */
export async function getReviewsForModeration(status: ReviewStatus, limit = 26, page = 1) {
  await requireAdmin();
  return prisma.review.findMany({
    where: { status },
    skip: (Math.max(1, Math.min(page, 9999)) - 1) * 25,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true, rating: true, comment: true, createdAt: true,
      user: { select: { name: true, email: true } },
      appointment: {
        select: {
          service: { select: { name: true } },
          stylist: { select: { name: true } },
        },
      },
    },
  });
}

export async function getPendingReviews() {
  return getReviewsForModeration('PENDING');
}
