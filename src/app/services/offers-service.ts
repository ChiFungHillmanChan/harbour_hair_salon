import 'server-only';
import { cache } from 'react';
import prisma from '@/app/lib/prisma';

// Header and Footer both need to know whether to show the "Offers" link. Wrapped
// in React cache() so the two callers share ONE count query per request instead
// of each hitting Neon independently.
export const hasActiveOffers = cache(async (): Promise<boolean> => {
  const count = await prisma.offer.count({ where: { isActive: true } });
  return count > 0;
});
