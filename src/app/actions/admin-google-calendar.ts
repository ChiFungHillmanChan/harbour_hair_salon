'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { appendAuditEvent } from '@/app/lib/audit';
import { googleCalendarConfig } from '@/app/lib/google-calendar-config';
import { verifySession } from '@/app/lib/session';
import { runGoogleCalendarJob } from '@/app/services/google-calendar-job';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { localizedPath } from '@/i18n/request';

/**
 * Admin → Integrations → "Sync now". It is the daily run of the calendar-sync
 * job (watch channel kept without renewing, the whole window pushed, one
 * single-flight pull), so the button and the crons cannot drift apart. With
 * the sync off it only redirects: no database, no Google.
 */
export async function syncGoogleCalendarNow(): Promise<void> {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
  if (!googleCalendarConfig()) redirect(await localizedPath('/admin/integrations?gcal=disabled'));

  const result = await runGoogleCalendarJob('daily');
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
