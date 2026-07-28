import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import prisma from '@/app/lib/prisma';

// Header and Footer both need to know whether to show the "Offers" link. Wrapped
// in React cache() so the two callers share ONE count query per request instead
// of each hitting Neon independently.
const getActiveOfferFlag = unstable_cache(async (): Promise<boolean> => {
  const count = await prisma.offer.count({ where: { isActive: true } });
  return count > 0;
}, ['active-offers'], { revalidate: 3600, tags: ['active-offers'] });

export const hasActiveOffers = cache(getActiveOfferFlag);

/**
 * The active site-wide (global) offer, newest wins — the same query the public
 * service pages use to render discounted prices. Returned so the booking flow
 * can charge/record the SAME price it advertises. Returns null when none is live.
 */
export async function getActiveGlobalOffer(): Promise<{ discountType: string; discountValue: number } | null> {
  const offer = await prisma.offer.findFirst({
    where: { isActive: true, isGlobal: true },
    orderBy: { createdAt: 'desc' },
    select: { discountType: true, discountValue: true },
  });
  if (!offer) return null;
  return { discountType: offer.discountType, discountValue: Number(offer.discountValue) };
}
