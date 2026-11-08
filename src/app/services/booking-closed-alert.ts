import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { isLocale, type Locale } from '@/i18n/config';
import { translator } from '@/i18n/messages';
import { localizeHref } from '@/i18n/paths';
import { isOnlineBookingLockedForPayments } from '@/app/lib/online-booking-lock';
import { SITE_URL } from '@/app/lib/site-url';
import type { EmailContent } from './email-content';
import { checkCalendarBookingReadiness } from './integration-readiness';
import { BOOKING_CLOSED_ALERT_JOB, checkOperationsRuntimeReadiness } from './operations-readiness';

/**
 * Tells the salon when online booking is switched on in Settings but the gate
 * is refusing customers: a calendar feed down in opening hours, or a failed
 * Operations diagnostics run. Customers just see the phone page, and neither
 * case reliably reaches the daily 08:00 alert, so nobody would know. Runs from
 * the calendar-sync cron (the same Neon wake), at most one email a London day.
 */

type AlertDb = Pick<PrismaClient, 'siteSettings' | 'stylist' | 'backgroundJobState'>;
type SendNotice = (content: EmailContent, idempotencyKey: string) => Promise<void>;

export function bookingClosedAlertContent(reasons: { calendar: boolean; diagnostics: boolean }, locale: Locale): EmailContent {
  const t = translator(locale, 'adminOps');
  const tm = translator(locale, 'emails');
  const label = t('bookingClosedAlert.label');
  return {
    locale,
    palette: 'ink',
    subject: t('bookingClosedAlert.subject'),
    preview: t('bookingClosedAlert.preview'),
    eyebrow: t('bookingClosedAlert.eyebrow'),
    title: t('bookingClosedAlert.title'),
    greeting: null,
    intro: t('bookingClosedAlert.intro'),
    details: [
      ...(reasons.calendar ? [{ label, value: t('bookingClosedAlert.reasons.calendar') }] : []),
      ...(reasons.diagnostics ? [{ label, value: t('bookingClosedAlert.reasons.diagnostics') }] : []),
    ],
    cta: { label: t('bookingClosedAlert.cta'), href: `${SITE_URL}${localizeHref(locale, '/admin/operations')}` },
    footnotes: [t('bookingClosedAlert.footnote')],
    address: tm('common.address'),
  };
}

export async function sendBookingClosedAlert(options: {
  db: AlertDb;
  now: Date;
  env: Record<string, string | undefined>;
  send: SendNotice;
}): Promise<{ sent: boolean }> {
  const { db, now, env, send } = options;
  if (env.NOTIFICATIONS_ENABLED !== 'true' || isOnlineBookingLockedForPayments()) return { sent: false };
  const settings = await db.siteSettings.findUnique({ where: { id: 'singleton' }, select: { bookingEnabled: true, salonNotificationLocale: true } });
  if (!settings?.bookingEnabled) return { sent: false };
  const [calendar, operations] = await Promise.all([
    checkCalendarBookingReadiness(db, now),
    checkOperationsRuntimeReadiness(db, now, env),
  ]);
  if (calendar.ready && operations.ready) return { sent: false };

  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);
  const job = await db.backgroundJobState.findUnique({ where: { name: BOOKING_CLOSED_ALERT_JOB }, select: { lastResultJson: true } });
  if (job?.lastResultJson === day) return { sent: false };

  // Staff mail follows the salon's own alert language (Traditional Chinese by default).
  const locale: Locale = isLocale(settings.salonNotificationLocale) ? settings.salonNotificationLocale : 'zh-HK';
  await send(bookingClosedAlertContent({ calendar: !calendar.ready, diagnostics: !operations.ready }, locale), `booking-closed/${day}`);
  await db.backgroundJobState.upsert({
    where: { name: BOOKING_CLOSED_ALERT_JOB },
    create: { name: BOOKING_CLOSED_ALERT_JOB, lastStartedAt: now, lastSucceededAt: now, lastResultJson: day },
    update: { lastStartedAt: now, lastSucceededAt: now, lastResultJson: day },
  });
  return { sent: true };
}
