'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { syncTreatwellFeeds } from '@/app/services/treatwell-sync-service';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
}

export async function runTreatwellIcalSyncAction(): Promise<void> {
  await requireAdmin();
  const results = await syncTreatwellFeeds();
  const failed = results.filter((result) => !result.ok).length;
  const upserted = results.reduce((total, result) => total + result.upserted, 0);

  revalidatePath('/admin/integrations');
  revalidatePath('/book');
  redirect(`/admin/integrations?ical=complete&feeds=${results.length}&failed=${failed}&upserted=${upserted}`);
}

export async function retryFailedTreatwellBookingsAction(): Promise<void> {
  await requireAdmin();
  const result = await prisma.appointment.updateMany({
    where: { treatwellSyncStatus: 'FAILED' },
    data: { treatwellSyncStatus: 'PENDING', treatwellSyncError: null },
  });

  revalidatePath('/admin/integrations');
  redirect(`/admin/integrations?retry=${result.count}`);
}
