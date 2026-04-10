import 'server-only';
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
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      user: { select: { name: true } },
      appointment: {
        include: {
          service: { select: { name: true } },
          stylist: { select: { name: true } },
        },
      },
    },
  });
}

export async function getPendingReviews() {
  return prisma.review.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { name: true, email: true } },
      appointment: {
        include: {
          service: { select: { name: true } },
          stylist: { select: { name: true } },
        },
      },
    },
  });
}
