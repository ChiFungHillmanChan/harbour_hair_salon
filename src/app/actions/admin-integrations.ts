'use server';

import { randomBytes } from 'crypto';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { invalidateStylistIcalToken } from '@/app/services/stylist-ical-cache';
import { redirect } from 'next/navigation';
import { appendAuditEvent } from '@/app/lib/audit';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { syncCalendarFeeds } from '@/app/services/calendar-sync-service';
import { CALENDAR_PROVIDERS } from '@/app/services/treatwell-sync-coverage';
import { saveCalendarConnectionSettings } from '@/app/services/calendar-connection-settings';
import { localizedPath } from '@/i18n/request';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
  return session;
}
function refreshIntegrations() {
  revalidateAllLocales(revalidatePath, '/admin/integrations');
  revalidateAllLocales(revalidatePath, '/admin');
  revalidateAllLocales(revalidatePath, '/book');
}

export async function saveCalendarConnectionAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const result = await saveCalendarConnectionSettings(formData, prisma, session.userId);
  // A code, not text: the page words it in the admin's language.
  if (!result.ok) redirect(await localizedPath(`/admin/integrations?calendarError=${result.code ?? 'INVALID_INPUT'}`));
  refreshIntegrations();
  redirect(await localizedPath('/admin/integrations?calendar=saved'));
}

export async function runCalendarIcalSyncAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.string().min(1).max(128).parse(formData.get('connectionId'));
  const results = await syncCalendarFeeds({ connectionId: id });
  const failed = results.filter((result) => !result.ok).length;
  const skipped = results.filter((result) => result.skipped).length;
  refreshIntegrations();
  redirect(await localizedPath(`/admin/integrations?ical=complete&feeds=${results.length}&failed=${failed}&skipped=${skipped}&upserted=${results.reduce((total, result) => total + result.upserted, 0)}`));
}

/** Kept for existing bookmarked/operator flows; now reconciles both providers. */
export async function runTreatwellIcalSyncAction(): Promise<void> {
  await requireAdmin();
  const results = await syncCalendarFeeds();
  refreshIntegrations();
  redirect(await localizedPath(`/admin/integrations?ical=complete&feeds=${results.length}&failed=${results.filter((r) => !r.ok).length}&upserted=${results.reduce((total, r) => total + r.upserted, 0)}`));
}

export async function confirmCalendarOutboundAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const input = z.object({ stylistId: z.string().min(1).max(128), provider: z.enum(CALENDAR_PROVIDERS), token: z.string().min(1).max(128), confirmed: z.literal('on') })
    .parse({ stylistId: formData.get('stylistId'), provider: formData.get('provider'), token: formData.get('token'), confirmed: formData.get('confirmed') });
  const confirmed = await prisma.$transaction(async (tx) => {
    // Lock/check the exact token the owner reviewed. A concurrent rotation
    // cannot leave a stale subscription marked as confirmed. Nothing has been
    // written when the token no longer matches.
    const matching = await tx.stylist.updateMany({ where: { id: input.stylistId, icalToken: input.token }, data: { updatedAt: new Date() } });
    if (!matching.count) return false;
    await tx.calendarConnection.upsert({
      where: { stylistId_provider: { stylistId: input.stylistId, provider: input.provider } },
      create: { stylistId: input.stylistId, provider: input.provider, outboundConfirmedAt: new Date() },
      update: { outboundConfirmedAt: new Date() },
    });
    await appendAuditEvent({ actorUserId: session.userId, action: 'CALENDAR.OUTBOUND_CONFIRM', targetType: 'Stylist', targetId: input.stylistId, metadata: { provider: input.provider } }, tx);
    return true;
  });
  if (!confirmed) redirect(await localizedPath('/admin/integrations?calendarError=FEED_URL_CHANGED'));
  refreshIntegrations();
  redirect(await localizedPath('/admin/integrations?calendar=confirmed'));
}

export async function generateStylistIcalFeedTokenAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const stylistId = z.string().min(1).max(128).parse(formData.get('stylistId'));
  await prisma.$transaction(async (tx) => {
    await tx.stylist.update({ where: { id: stylistId }, select: { id: true }, data: { icalToken: randomBytes(24).toString('base64url') } });
    await tx.calendarConnection.updateMany({ where: { stylistId }, data: { outboundConfirmedAt: null } });
    await appendAuditEvent({ actorUserId: session.userId, action: 'CALENDAR.TOKEN_ROTATE', targetType: 'Stylist', targetId: stylistId }, tx);
  });
  // Without this the rotated-away token would keep working, and the new one
  // would 404, until the token cache happened to expire.
  invalidateStylistIcalToken();
  refreshIntegrations();
  redirect(await localizedPath('/admin/integrations?feedToken=rotated'));
}

export async function retryFailedTreatwellBookingsAction(): Promise<void> {
  await requireAdmin();
  throw new Error('Outbound API delivery is disabled until a verified provider contract and idempotency tests are configured.');
}
