'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { appendAuditEvent } from '@/app/lib/audit';
import { isGoogleColorId } from '@/app/lib/calendar-colors';
import { describeFault } from '@/app/lib/fault';
import { googleCalendarConfig } from '@/app/lib/google-calendar-config';
import { verifySession } from '@/app/lib/session';
import { runGoogleCalendarJob } from '@/app/services/google-calendar-job';
import { invalidateStylistIcalFeed } from '@/app/services/stylist-ical-cache';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { localizedPath } from '@/i18n/request';

/** The Integrations page's maxDuration (src/app/[locale]/admin/integrations/page.tsx), which this action runs under. */
const PAGE_MAX_DURATION_MS = 300_000;

/**
 * Admin → Integrations → "Sync now". It is the daily run of the calendar-sync
 * job (the whole window pushed, one single-flight pull), so the button and the
 * crons cannot drift apart, except that it also replaces the watch channel at
 * once (`renew`): after GOOGLE_CALENDAR_WEBHOOK_SECRET is rotated and
 * redeployed, Sync now is what makes Google's notifications pass again. With
 * the sync off it only redirects: no database, no Google.
 */
export async function syncGoogleCalendarNow(): Promise<void> {
  // When this function is cut off: the job skips its pull rather than start it too late.
  const deadline = Date.now() + PAGE_MAX_DURATION_MS;
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
  if (!googleCalendarConfig()) redirect(await localizedPath('/admin/integrations?gcal=disabled'));

  const result = await runGoogleCalendarJob('daily', { deadline, renew: true });
  const outcome = 'ok' in result && result.ok ? 'done' : 'error';
  try {
    await appendAuditEvent({
      actorUserId: session.userId,
      action: 'INTEGRATION.GOOGLE_CALENDAR_SYNC',
      targetType: 'Integration',
      targetId: 'google-calendar',
      metadata: { outcome },
    });
  } catch {
    // The sync already ran and nothing is lost by saying so.
    console.error('Recording the Google Calendar sync in the audit log failed');
  }
  revalidateAllLocales(revalidatePath, '/admin/integrations');
  redirect(await localizedPath(`/admin/integrations?gcal=${outcome}`));
}

/**
 * Admin → Integrations → "Clear Google busy time and diary copy": makes turning the sync off
 * reversible. Busy time already read from Google (`ExternalBusyBlock` source
 * GOOGLE) otherwise stays on the website, and in the busy feed Fresha imports,
 * until its time has passed, because nothing reads Google any more. This
 * deletes every GOOGLE block (no other source) and the copy of the diary
 * (`GoogleDiaryEntry`), forgets the hash of the blocks last stored and records
 * who did it, in one transaction; then the busy feeds
 * are dropped, so Fresha's next poll sees the time free. It works whether the
 * sync is on or off: while it is on, the next check of Google reads the
 * calendar's busy time again. Administrators only; the page asks to confirm.
 */
export async function clearGoogleBusyTime(): Promise<void> {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
  const prisma = (await import('@/app/lib/prisma')).default;
  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.externalBusyBlock.deleteMany({ where: { source: 'GOOGLE' } });
      const diary = await tx.googleDiaryEntry.deleteMany({});
      await tx.googleCalendarSyncState.updateMany({ where: { id: 'singleton' }, data: { busyHash: null } });
      await appendAuditEvent({
        actorUserId: session.userId,
        action: 'INTEGRATION.GOOGLE_BUSY_CLEARED',
        targetType: 'Integration',
        targetId: 'google-calendar',
        metadata: { removed: count, diaryRemoved: diary.count },
      }, tx);
    });
  } catch (error) {
    console.error('Clearing the Google busy time failed:', describeFault(error));
    redirect(await localizedPath('/admin/integrations?gcal=clearError'));
  }
  // After the commit. (With the sync on it also schedules a push; harmless.)
  invalidateStylistIcalFeed();
  for (const path of ['/admin/integrations', '/admin', '/book']) revalidateAllLocales(revalidatePath, path);
  redirect(await localizedPath('/admin/integrations?gcal=cleared'));
}

/**
 * Admin → Integrations → Google Calendar → "Diary colours" (spec §3): the
 * no-stylist and leave colours. They must differ and no active stylist may
 * hold either. Read live by the pull and the push; applied by the next sync.
 */
export async function saveGoogleDiaryColours(formData: FormData): Promise<void> {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
  const unassigned = String(formData.get('googleUnassignedColorId') ?? '');
  const leave = String(formData.get('googleLeaveColorId') ?? '');
  if (!isGoogleColorId(unassigned) || !isGoogleColorId(leave)) redirect(await localizedPath('/admin/integrations?gcal=coloursInvalid'));
  if (unassigned === leave) redirect(await localizedPath('/admin/integrations?gcal=coloursSame'));
  const prisma = (await import('@/app/lib/prisma')).default;
  const holder = await prisma.stylist.findFirst({ where: { isActive: true, googleColorId: { in: [unassigned, leave] } }, select: { name: true } });
  if (holder) redirect(await localizedPath('/admin/integrations?gcal=coloursTaken'));
  await prisma.$transaction(async (tx) => {
    const colours = { googleUnassignedColorId: unassigned, googleLeaveColorId: leave };
    await tx.siteSettings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...colours }, update: colours });
    await appendAuditEvent({
      actorUserId: session.userId,
      action: 'INTEGRATION.GOOGLE_DIARY_COLOURS',
      targetType: 'Integration',
      targetId: 'google-calendar',
      metadata: { unassigned, leave },
    }, tx);
  });
  for (const path of ['/admin/integrations', '/admin']) revalidateAllLocales(revalidatePath, path);
  redirect(await localizedPath('/admin/integrations?gcal=coloursSaved'));
}
