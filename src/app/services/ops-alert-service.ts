import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { isLocale, type Locale } from '@/i18n/config';
import { formatSalonDateTime } from '@/i18n/dates';
import { translator } from '@/i18n/messages';
import { localizeHref } from '@/i18n/paths';
import { SITE_URL } from '@/app/lib/site-url';
import type { EmailContent } from './email-content';
import { OPERATIONS_READINESS_JOB } from './operations-readiness';
import { alertWindows, collectPaymentAttention, countPaymentAttention, type PaymentAttentionCounts } from './payment-attention';

/**
 * The salon's daily "needs attention" email. Apart from the booking-closed
 * notice (booking-closed-alert.ts), nothing else pushes a problem to anyone:
 * failed emails, a failing scheduled job, a dead Fresha feed or a card
 * deposit nothing could settle (payment-attention.ts) only show up if someone
 * opens Admin → Operations. It runs inside the existing
 * 08:00 UTC reminders cron (the same Neon wake — no new schedule) and sends
 * nothing on a good day.
 */

type OpsDb = Pick<PrismaClient,
  'notificationDelivery' | 'backgroundJobState' | 'calendarConnection' | 'appointment' | 'siteSettings'
  | 'paymentAttempt' | 'paymentRefund' | 'squareWebhookEvent'>;

export type OpsFinding =
  | { kind: 'HOUSEKEEPING_OFF' }
  | { kind: 'DELIVERIES_FAILED'; count: number }
  | { kind: 'JOB_FAILING'; job: string; since: Date }
  | { kind: 'CALENDAR_ERROR'; stylist: string; provider: string }
  | { kind: 'CALENDAR_STALE'; stylist: string; provider: string; lastSuccessAt: Date | null }
  | { kind: 'REQUESTS_WAITING'; count: number; oldestCreatedAt: Date }
  // Card deposits and refunds nothing could settle by itself (payment-attention.ts).
  | ({ kind: 'PAYMENTS_NEED_ATTENTION' } & PaymentAttentionCounts);

/**
 * The order the payment lines are listed in the email, most urgent first: a
 * Square setup refusal turns every customer away, so it leads.
 */
const PAYMENT_LINES: (keyof PaymentAttentionCounts)[] = [
  'squareSetupRefused', 'takenNotConfirmed', 'takenOnCancelled', 'refundsFailed', 'refundsUnresolved', 'lateCaptures', 'cardDeclines',
  'awaitingSquare', 'holdsNotReleased', 'refundsUnconfirmed', 'unmatchedNotifications',
];

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export async function collectOpsFindings(db: OpsDb, now: Date, options: { calendarSyncEnabled: boolean; housekeepingEnabled: boolean }): Promise<OpsFinding[]> {
  const [failedDeliveries, jobs, connections, waiting, payments] = await Promise.all([
    // Final failures only: a delivery still inside its retry window says PENDING.
    db.notificationDelivery.count({ where: { status: 'FAILED', updatedAt: { gte: new Date(now.getTime() - DAY) } } }),
    db.backgroundJobState.findMany({ select: { name: true, lastFailedAt: true, lastSucceededAt: true } }),
    // The overnight pause (calendar-sync skips ticks outside staff hours) makes
    // every feed look a few hours old at 08:00 UTC, so "stale" means a whole
    // day without one good import, not "older than the usual cadence".
    options.calendarSyncEnabled
      ? db.calendarConnection.findMany({
        where: { inboundEnabled: true, inboundUrl: { not: null }, stylist: { isActive: true } },
        select: { provider: true, lastSuccessAt: true, lastError: true, stylist: { select: { name: true } } },
        orderBy: [{ stylistId: 'asc' }, { provider: 'asc' }],
      })
      : Promise.resolve([]),
    db.appointment.findMany({
      where: { status: 'PENDING', date: { gt: now }, createdAt: { lt: new Date(now.getTime() - HOUR) } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }),
    collectPaymentAttention(db, now, alertWindows(now), 100),
  ]);

  const findings: OpsFinding[] = [];
  // Mail is going out (this runs only with NOTIFICATIONS_ENABLED) but nothing
  // recovers a crashed delivery or clears old personal data from the queue.
  if (!options.housekeepingEnabled) findings.push({ kind: 'HOUSEKEEPING_OFF' });
  if (failedDeliveries > 0) findings.push({ kind: 'DELIVERIES_FAILED', count: failedDeliveries });
  for (const job of jobs) {
    // The readiness report is an on-demand diagnostic, not a schedule.
    if (job.name === OPERATIONS_READINESS_JOB || !job.lastFailedAt) continue;
    const stillFailing = !job.lastSucceededAt || job.lastFailedAt > job.lastSucceededAt;
    if (stillFailing && job.lastFailedAt.getTime() > now.getTime() - 2 * DAY) {
      findings.push({ kind: 'JOB_FAILING', job: job.name, since: job.lastFailedAt });
    }
  }
  for (const connection of connections) {
    const where = { stylist: connection.stylist.name, provider: connection.provider };
    if (connection.lastError) findings.push({ kind: 'CALENDAR_ERROR', ...where });
    else if (!connection.lastSuccessAt || connection.lastSuccessAt.getTime() < now.getTime() - DAY) {
      findings.push({ kind: 'CALENDAR_STALE', ...where, lastSuccessAt: connection.lastSuccessAt });
    }
  }
  if (waiting.length > 0) findings.push({ kind: 'REQUESTS_WAITING', count: waiting.length, oldestCreatedAt: waiting[0].createdAt });
  const paymentCounts = countPaymentAttention(payments);
  if (Object.values(paymentCounts).some((count) => count > 0)) findings.push({ kind: 'PAYMENTS_NEED_ATTENTION', ...paymentCounts });
  return findings;
}

const PROVIDER_NAMES: Record<string, string> = { FRESHA: 'Fresha', TREATWELL: 'Treatwell', BOOKSY: 'Booksy' };

export function opsAlertContent(findings: OpsFinding[], locale: Locale): EmailContent {
  const t = translator(locale, 'adminOps');
  const tm = translator(locale, 'emails');
  const when = (date: Date | null) => (date ? formatSalonDateTime(locale, date) : t('operations.never'));
  const provider = (code: string) => PROVIDER_NAMES[code] ?? code;
  const details = findings.flatMap((finding) => {
    switch (finding.kind) {
      case 'HOUSEKEEPING_OFF':
        return { label: t('opsAlert.labels.jobs'), value: t('opsAlert.findings.HOUSEKEEPING_OFF') };
      case 'DELIVERIES_FAILED':
        return { label: t('opsAlert.labels.emails'), value: t('opsAlert.findings.DELIVERIES_FAILED', { count: finding.count }) };
      case 'JOB_FAILING':
        return { label: t('opsAlert.labels.jobs'), value: t('opsAlert.findings.JOB_FAILING', { job: finding.job, time: when(finding.since) }) };
      case 'CALENDAR_ERROR':
        return { label: t('opsAlert.labels.calendars'), value: t('opsAlert.findings.CALENDAR_ERROR', { stylist: finding.stylist, provider: provider(finding.provider) }) };
      case 'CALENDAR_STALE':
        return { label: t('opsAlert.labels.calendars'), value: t('opsAlert.findings.CALENDAR_STALE', { stylist: finding.stylist, provider: provider(finding.provider), time: when(finding.lastSuccessAt) }) };
      case 'REQUESTS_WAITING':
        return { label: t('opsAlert.labels.requests'), value: t('opsAlert.findings.REQUESTS_WAITING', { count: finding.count, time: when(finding.oldestCreatedAt) }) };
      case 'PAYMENTS_NEED_ATTENTION':
        // One line per kind of problem, most urgent first.
        return PAYMENT_LINES.filter((line) => finding[line] > 0).map((line) => ({
          label: t('opsAlert.labels.payments'),
          value: t.dynamic(`opsAlert.findings.PAYMENTS_NEED_ATTENTION.${line}`, { count: finding[line] }),
        }));
    }
  });
  return {
    locale,
    palette: 'ink',
    subject: t('opsAlert.subject', { count: findings.length }),
    preview: t('opsAlert.preview', { count: findings.length }),
    eyebrow: t('opsAlert.eyebrow'),
    title: t('opsAlert.title'),
    greeting: null,
    intro: t('opsAlert.intro'),
    details,
    cta: { label: t('opsAlert.cta'), href: `${SITE_URL}${localizeHref(locale, '/admin/operations')}` },
    footnotes: [t('opsAlert.footnote')],
    address: tm('common.address'),
  };
}

type SendNotice = (content: EmailContent, idempotencyKey: string) => Promise<void>;

/** Collect, and email the salon only when something needs attention. */
export async function sendDailyOpsAlert(options: {
  db: OpsDb;
  now: Date;
  calendarSyncEnabled: boolean;
  housekeepingEnabled: boolean;
  send: SendNotice;
}): Promise<{ sent: boolean; findings: number }> {
  const findings = await collectOpsFindings(options.db, options.now, options);
  if (findings.length === 0) return { sent: false, findings: 0 };
  const settings = await options.db.siteSettings.findUnique({ where: { id: 'singleton' }, select: { salonNotificationLocale: true } });
  // Staff mail follows the salon's own alert language (Traditional Chinese by default).
  const locale: Locale = isLocale(settings?.salonNotificationLocale) ? settings.salonNotificationLocale : 'zh-HK';
  // One per London day, even if the cron is re-run by hand.
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(options.now);
  await options.send(opsAlertContent(findings, locale), `ops-alert/${day}`);
  return { sent: true, findings: findings.length };
}
