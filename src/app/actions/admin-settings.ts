'use server';

import { z } from 'zod';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { revalidatePath, updateTag } from 'next/cache';
import { appendAuditEvent } from '@/app/lib/audit';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { checkCalendarBookingReadiness } from '@/app/services/integration-readiness';
import { checkOperationsBookingReadiness } from '@/app/services/operations-readiness';
import { LOCALES } from '@/i18n/config';
import { getActionT } from '@/i18n/request';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
  return session;
}

// Messages are codes, translated below together with the field's label.
const urlOrEmpty = z
  .string()
  .trim()
  .max(500, 'TOO_LONG')
  .refine((v) => v === '' || /^https?:\/\//.test(v), {
    message: 'URL',
  });

/**
 * Operational settings, saved immediately in both languages. The homepage
 * hero text is bilingual content and is NOT saved here — it is drafted and
 * published in both languages by the editor on the same page
 * (actions/admin-content.ts), so this form can never overwrite it.
 */
const settingsSchema = z.object({
  phone: z
    .string()
    .trim()
    .max(40, 'TOO_LONG')
    .regex(/^[0-9+()\s-]*$/, 'PHONE')
    .default('07831 830898'),
  twitterHandle: z.string().trim().max(40, 'TOO_LONG').default(''),
  gscVerification: z.string().trim().max(200, 'TOO_LONG').default(''),
  googleBusinessUrl: urlOrEmpty.default(''),
  facebookUrl: urlOrEmpty.default(''),
  instagramUrl: urlOrEmpty.default(''),
  treatwellUrl: urlOrEmpty.default(''),
  freshaUrl: urlOrEmpty.default(''),
  booksyUrl: urlOrEmpty.default(''),
  // Language of the salon's own new-booking alerts; customer mails follow
  // each booking's own language.
  salonNotificationLocale: z.enum(LOCALES, 'LOCALE').default('zh-HK'),
  // An unchecked checkbox is absent from FormData entirely, so this is parsed
  // from an explicit boolean the action computes rather than from the raw entry.
  bookingEnabled: z.boolean().default(false),
});

export type SettingsActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

export async function updateSiteSettings(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const session = await requireAdmin();
  const t = await getActionT('adminContent');

  const parsed = settingsSchema.safeParse({
    ...Object.fromEntries(formData),
    bookingEnabled: formData.get('bookingEnabled') === 'on',
  });
  if (!parsed.success) {
    // Name the offending field — otherwise the owner just sees a generic
    // message over a dozen boxes with no idea which one to fix.
    const issue = parsed.error.issues[0];
    const field = String(issue?.path[0] ?? '');
    const message = t.dynamic(`settings.errors.${issue?.message}`, undefined, t('settings.errors.INVALID'));
    const label = t.has(`settings.fields.${field}`) ? t.dynamic(`settings.fields.${field}`) : null;
    return { status: 'error', message: label ? t('settings.errors.field', { field: label, message }) : message };
  }

  try {
    const blockers = await prisma.$transaction(async (tx) => {
      // Closing booking must remain possible during any provider outage, and
      // only turning booking ON needs launch evidence. While it is already on,
      // every booking attempt re-checks readiness (assertOnlineBookingReady), so
      // editing the phone number or hero text must not fail just because
      // marketplace imports pause outside staff hours.
      const current = await tx.siteSettings.findUnique({ where: { id: 'singleton' }, select: { bookingEnabled: true } });
      if (parsed.data.bookingEnabled && !current?.bookingEnabled) {
        const calendar = await checkCalendarBookingReadiness(tx);
        const operations = await checkOperationsBookingReadiness(tx);
        // Both checks return codes alongside their English blockers
        // (issues[i] matches blockers[i]); show them in the admin's language,
        // falling back to the English diagnostic when a code is missing.
        // Calendar texts are the detail only, so the stylist (and provider)
        // prefix is added back here, as on the Integrations page.
        const tOps = await getActionT('adminOps');
        const localize = (group: 'calendar' | 'operations', blockers: string[], issues?: { code: string; params?: Record<string, string | number | undefined> }[]) =>
          blockers.map((blocker, index) => {
            const issue = issues?.[index];
            if (!issue) return blocker;
            const detail = tOps.dynamic(`readiness.${group}.${issue.code}`, issue.params, blocker);
            const stylist = issue.params?.stylist;
            const provider = issue.params?.provider;
            if (group !== 'calendar' || !stylist) return detail;
            return provider
              ? tOps('integrations.checkForProvider', { stylist, provider, detail })
              : tOps('integrations.checkForStylist', { stylist, detail });
          });
        const reasons = [...localize('calendar', calendar.blockers, calendar.issues), ...localize('operations', operations.blockers, operations.issues)];
        const activeChannels = await tx.calendarConnection.count({ where: { receivesBookings: true } });
        if (activeChannels && process.env.CALENDAR_SYNC_ENABLED !== 'true') {
          reasons.push(t('settings.errors.CALENDAR_SYNC'));
        }
        if (!calendar.ready || !operations.ready || reasons.length) {
          return reasons.length ? reasons : [t('settings.errors.READINESS')];
        }
      }
      await tx.siteSettings.upsert({
        where: { id: 'singleton' },
        update: parsed.data,
        create: { id: 'singleton', ...parsed.data },
      });
      await appendAuditEvent({ actorUserId: session.userId, action: 'SETTINGS.UPDATE', targetType: 'SiteSettings', targetId: 'singleton', metadata: { bookingEnabled: parsed.data.bookingEnabled, salonNotificationLocale: parsed.data.salonNotificationLocale } }, tx);
      return [];
    }, { isolationLevel: 'Serializable' });
    if (blockers.length) return { status: 'error', message: t('settings.errors.NOT_SAVED', { reasons: blockers.join(' ') }) };
  } catch {
    return { status: 'error', message: t('settings.errors.SAVE_FAILED') };
  }

  updateTag('site-settings');
  revalidatePath('/', 'layout');
  revalidatePath('/sitemap.xml');
  // Opening or closing booking must take effect immediately on the pages that
  // branch on it, not after the settings cache happens to expire.
  revalidateAllLocales(revalidatePath, '/book');
  revalidateAllLocales(revalidatePath, '/appointments');

  return { status: 'success' };
}
