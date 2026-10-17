import { AdminResponsiveTable } from '@/components/admin/AdminResponsiveTable';
import { requireAdmin } from '@/app/lib/session';
import Link from '@/i18n/link';
import prisma from '@/app/lib/prisma';
import { pageNumber } from '@/app/lib/pagination';
import { Pagination } from '@/components/admin/Pagination';
import { OPERATIONS_READINESS_JOB, parseOperationsChecks } from '@/app/services/operations-readiness';
import { operationsMessageKey } from '@/app/services/operations-messages';
import { OperationsControls } from '@/components/admin/OperationsControls';
import { collectPaymentAttention, pageWindows } from '@/app/services/payment-attention';
import { formatGBP } from '@/app/services/pricing/money';
import { HTML_LANG } from '@/i18n/config';
import { formatSalonDateTime } from '@/i18n/dates';
import { getLocale, getT } from '@/i18n/server';

export const dynamic = 'force-dynamic';

const HOUR = 60 * 60_000;

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const [query, locale, t] = await Promise.all([searchParams, getLocale(), getT('adminOps')]);
  const page = pageNumber(query.page);
  const now = new Date();
  const date = (value: Date | null) => value ? formatSalonDateTime(locale, value) : t('operations.never');
  // Metadata only: never select recipients, notification payloads or tokens —
  // and for card deposits, booking ids, amounts, states and times, never who paid.
  const [jobs, deliveries, auditRows, payments] = await Promise.all([
    prisma.backgroundJobState.findMany({ orderBy: { name: 'asc' }, select: {
      name: true, lastStartedAt: true, lastSucceededAt: true, lastFailedAt: true, lastError: true, lastResultJson: true,
    } }),
    prisma.notificationDelivery.findMany({ orderBy: { createdAt: 'desc' }, take: 30,
      select: { id: true, kind: true, status: true, attempts: true, lastError: true } }),
    prisma.auditEvent.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 26, skip: (page - 1) * 25,
      select: { id: true, actorUserId: true, action: true, targetType: true, targetId: true, createdAt: true } }),
    collectPaymentAttention(prisma, now, pageWindows(now)),
  ]);
  const report = jobs.find((job) => job.name === OPERATIONS_READINESS_JOB);
  const checks = parseOperationsChecks(report?.lastResultJson).filter((check) => check.id !== 'configuration');
  const cronJobs = jobs.filter((job) => job.name !== OPERATIONS_READINESS_JOB);
  const none = t('operations.none');
  // Our own fixed lastError sentences are translated; anything else (older
  // rows, feed or provider text) stays exactly as recorded, marked English.
  const lastError = (text: string | null) => {
    if (!text) return none;
    const key = operationsMessageKey(text);
    return key ? t(`operations.messages.${key}`) : <span lang="en">{text}</span>;
  };
  const money = (pence: number) => formatGBP(pence, HTML_LANG[locale]);
  const age = (since: Date) => {
    const hours = Math.max(0, Math.floor((now.getTime() - since.getTime()) / HOUR));
    return hours < 48 ? t('operations.payments.age.hours', { count: hours }) : t('operations.payments.age.days', { count: Math.floor(hours / 24) });
  };
  const booking = (id: string | null, start: Date | null) => id
    ? <><span className="font-mono text-xs [overflow-wrap:anywhere]">{id}</span>{start && <span className="block text-xs text-zinc-500">{date(start)}</span>}</>
    : t('operations.payments.noBooking');
  const nothingOwed = !payments.attempts.length && !payments.refunds.length && !payments.notifications.length && payments.setupRefusals === 0;
  // Job names, delivery IDs and audit action codes are raw diagnostics and
  // stay exactly as recorded.
  return <div className="mx-auto min-w-0 max-w-6xl space-y-4 p-3 sm:space-y-7 sm:p-6 lg:p-8">
    <header>
      <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">{t('operations.title')}</h1>
      <p className="mt-2 text-sm sm:text-base text-zinc-600">{t('operations.intro')}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-900"><Link className="inline-flex min-h-11 items-center underline" href="/admin/integrations">{t('operations.links.integrations')}</Link><Link className="inline-flex min-h-11 items-center underline" href="/admin/settings">{t('operations.links.settings')}</Link></div>
    </header>
    <OperationsControls notificationsEnabled={process.env.NOTIFICATIONS_ENABLED === 'true'} />
    <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3 sm:p-5">
      <h2 className="text-lg font-semibold text-zinc-900">{t('operations.report.title')}</h2>
      <p className="mt-1 text-sm text-zinc-500">{t('operations.report.lastRun', { time: date(report?.lastStartedAt ?? null) })}</p>
      {checks.length ? <ul className="mt-4 divide-y divide-zinc-100">{checks.map((check) => <li key={check.id} className="py-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3"><span className={`rounded px-2 py-1 text-xs font-semibold uppercase ${check.status === 'pass' ? 'bg-green-50 text-green-800' : check.status === 'fail' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>{t.dynamic(`operations.checkStatus.${check.status}`, undefined, check.status)}</span><h3 className="min-w-0 break-words font-medium text-zinc-900">{t.dynamic(`readiness.labels.${check.id}`, undefined, check.label)}</h3></div>
        {/* Reports saved before checks carried a code are shown as saved (English). */}
        <p className="mt-2 break-words text-sm text-zinc-600" lang={check.code ? undefined : 'en'}>{check.code ? t.dynamic(`readiness.operations.${check.code}`, check.params, check.message) : check.message}</p>
      </li>)}</ul> : <p className="mt-4 text-sm text-zinc-600">{t('operations.report.empty')}</p>}
      <p className="mt-4 text-sm text-zinc-600">{t('operations.report.caveat')}</p>
    </section>
    <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3 sm:p-5" aria-labelledby="payments-attention">
      <h2 id="payments-attention" className="text-lg font-semibold text-zinc-900">{t('operations.payments.title')}</h2>
      <p className="mt-2 text-sm text-zinc-600">{t('operations.payments.intro')}</p>
      {nothingOwed ? <p className="mt-3 text-sm text-zinc-600">{t('operations.payments.empty')}</p> : null}
      {/* The website's own Square setup refused (401/403/404): a configuration problem, never card declines. */}
      {payments.setupRefusals > 0 ? <p className="mt-3 text-sm font-medium text-zinc-900">{t('operations.payments.setupRefusals', { count: payments.setupRefusals })} <span className="font-normal text-zinc-600">{t('operations.payments.setupRefusalsHelp')}</span></p> : null}
      {payments.declines > 0 ? <p className="mt-3 text-sm text-zinc-700">{t('operations.payments.declines', { count: payments.declines })} <span className="text-zinc-500">{t('operations.payments.declinesHelp')}</span></p> : null}
      {payments.attempts.length ? <>
        <h3 className="mt-4 font-medium text-zinc-900">{t('operations.payments.deposits')}</h3>
        <div className="mt-2 overflow-x-auto"><AdminResponsiveTable className="text-left text-sm"><thead><tr className="border-b text-zinc-500"><th className="p-2">{t('operations.payments.columns.booking')}</th><th className="p-2">{t('operations.payments.columns.amount')}</th><th className="p-2">{t('operations.payments.columns.status')}</th><th className="p-2">{t('operations.payments.columns.problem')}</th><th className="p-2">{t('operations.payments.columns.since')}</th><th className="p-2">{t('operations.payments.columns.lastError')}</th></tr></thead>
          <tbody>{payments.attempts.map((row) => <tr key={row.id} className="border-b border-zinc-100"><td data-label={t('operations.payments.columns.booking')} data-primary className="p-2">{booking(row.appointmentId, row.appointmentDate)}</td><td data-label={t('operations.payments.columns.amount')} className="p-2 tabular-nums">{money(row.amountPence)}</td><td data-label={t('operations.payments.columns.status')} className="p-2">{t.dynamic(`operations.payments.attemptStatus.${row.status}`, undefined, row.status)}</td><td data-label={t('operations.payments.columns.problem')} data-actions className="p-2 font-medium">{t(`operations.payments.problems.${row.problem}`)}</td><td data-label={t('operations.payments.columns.since')} className="p-2">{age(row.since)}</td><td data-label={t('operations.payments.columns.lastError')} data-actions className="max-w-sm break-words p-2">{lastError(row.lastError)}</td></tr>)}</tbody>
        </AdminResponsiveTable></div>
      </> : null}
      {payments.refunds.length ? <>
        <h3 className="mt-4 font-medium text-zinc-900">{t('operations.payments.refunds')}</h3>
        <div className="mt-2 overflow-x-auto"><AdminResponsiveTable className="text-left text-sm"><thead><tr className="border-b text-zinc-500"><th className="p-2">{t('operations.payments.columns.booking')}</th><th className="p-2">{t('operations.payments.columns.amount')}</th><th className="p-2">{t('operations.payments.columns.status')}</th><th className="p-2">{t('operations.payments.columns.reason')}</th><th className="p-2">{t('operations.payments.columns.problem')}</th><th className="p-2">{t('operations.payments.columns.since')}</th></tr></thead>
          <tbody>{payments.refunds.map((row) => <tr key={row.id} className="border-b border-zinc-100"><td data-label={t('operations.payments.columns.booking')} data-primary className="p-2">{booking(row.appointmentId, row.appointmentDate)}</td><td data-label={t('operations.payments.columns.amount')} className="p-2 tabular-nums">{money(row.amountPence)}</td><td data-label={t('operations.payments.columns.status')} className="p-2">{t.dynamic(`operations.payments.refundStatus.${row.status}`, undefined, row.status)}</td><td data-label={t('operations.payments.columns.reason')} className="p-2">{t.dynamic(`operations.payments.reasons.${row.reason}`, undefined, row.reason)}</td><td data-label={t('operations.payments.columns.problem')} data-actions className="p-2 font-medium">{t(`operations.payments.problems.${row.problem}`)}</td><td data-label={t('operations.payments.columns.since')} className="p-2">{age(row.since)}</td></tr>)}</tbody>
        </AdminResponsiveTable></div>
      </> : null}
      {payments.notifications.length ? <>
        <h3 className="mt-4 font-medium text-zinc-900">{t('operations.payments.notifications')}</h3>
        <p className="mt-1 text-sm text-zinc-600">{t('operations.payments.notificationsIntro')}</p>
        {/* Square's own event type and object id: raw identifiers, as recorded. */}
        <div className="mt-2 overflow-x-auto"><AdminResponsiveTable className="text-left text-sm"><thead><tr className="border-b text-zinc-500"><th className="p-2">{t('operations.payments.columns.type')}</th><th className="p-2">{t('operations.payments.columns.object')}</th><th className="p-2">{t('operations.payments.columns.received')}</th></tr></thead>
          <tbody>{payments.notifications.map((row) => <tr key={row.eventId} className="border-b border-zinc-100"><td data-label={t('operations.payments.columns.type')} data-primary className="p-2 font-mono text-xs" lang="en">{row.type}</td><td data-label={t('operations.payments.columns.object')} data-actions className="p-2 font-mono text-xs">{row.objectId ?? none}</td><td data-label={t('operations.payments.columns.received')} className="p-2">{date(row.receivedAt)}</td></tr>)}</tbody>
        </AdminResponsiveTable></div>
      </> : null}
    </section>
    <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3 sm:p-5">
      <h2 className="text-lg font-semibold text-zinc-900">{t('operations.jobs.title')}</h2>
      {cronJobs.length ? <div className="mt-4 overflow-x-auto"><AdminResponsiveTable className="text-left text-sm"><thead><tr className="border-b text-zinc-500"><th className="p-2">{t('operations.jobs.columns.job')}</th><th className="p-2">{t('operations.jobs.columns.started')}</th><th className="p-2">{t('operations.jobs.columns.succeeded')}</th><th className="p-2">{t('operations.jobs.columns.failed')}</th><th className="p-2">{t('operations.jobs.columns.lastError')}</th></tr></thead><tbody>{cronJobs.map((job) => <tr key={job.name} className="border-b border-zinc-100"><td data-label={t('operations.jobs.columns.job')} data-primary className="p-2 font-medium">{job.name}</td><td data-label={t('operations.jobs.columns.started')} className="p-2">{date(job.lastStartedAt)}</td><td data-label={t('operations.jobs.columns.succeeded')} className="p-2">{date(job.lastSucceededAt)}</td><td data-label={t('operations.jobs.columns.failed')} className="p-2">{date(job.lastFailedAt)}</td><td data-label={t('operations.jobs.columns.lastError')} data-actions className="max-w-sm break-words p-2">{lastError(job.lastError)}</td></tr>)}</tbody></AdminResponsiveTable></div> : <p className="mt-3 text-sm text-zinc-600">{t('operations.jobs.empty')}</p>}
    </section>
    <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3 sm:p-5">
      <h2 className="text-lg font-semibold text-zinc-900">{t('operations.deliveries.title')}</h2>
      <p className="mt-2 text-sm text-zinc-600">{t('operations.deliveries.intro')}</p>
      {deliveries.length ? <div className="mt-4 overflow-x-auto"><AdminResponsiveTable className="text-left text-sm"><thead><tr className="border-b text-zinc-500"><th className="p-2">{t('operations.deliveries.columns.id')}</th><th className="p-2">{t('operations.deliveries.columns.type')}</th><th className="p-2">{t('operations.deliveries.columns.status')}</th><th className="p-2">{t('operations.deliveries.columns.attempts')}</th><th className="p-2">{t('operations.deliveries.columns.lastError')}</th></tr></thead><tbody>{deliveries.map((delivery) => <tr key={delivery.id} className="border-b border-zinc-100"><td data-label={t('operations.deliveries.columns.id')} data-primary className="p-2 font-mono text-xs">{delivery.id}</td><td data-label={t('operations.deliveries.columns.type')} className="p-2">{t.dynamic(`operations.deliveries.kind.${delivery.kind}`, undefined, delivery.kind)}</td><td data-label={t('operations.deliveries.columns.status')} className="p-2">{t.dynamic(`operations.deliveries.status.${delivery.status}`, undefined, delivery.status)}</td><td data-label={t('operations.deliveries.columns.attempts')} className="p-2">{delivery.attempts}</td><td data-label={t('operations.deliveries.columns.lastError')} data-actions className="max-w-sm break-words p-2">{lastError(delivery.lastError)}</td></tr>)}</tbody></AdminResponsiveTable></div> : <p className="mt-3 text-sm text-zinc-600">{t('operations.deliveries.empty')}</p>}
    </section>
    <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3 sm:p-5">
      <h2 className="text-lg font-semibold text-zinc-900">{t('operations.audit.title')}</h2>
      <p className="mt-2 text-sm text-zinc-600">{t('operations.audit.intro')}</p>
      <div className="mt-4 overflow-x-auto"><AdminResponsiveTable className="text-left text-sm"><thead><tr className="border-b"><th className="p-2">{t('operations.audit.columns.time')}</th><th className="p-2">{t('operations.audit.columns.actor')}</th><th className="p-2">{t('operations.audit.columns.action')}</th><th className="p-2">{t('operations.audit.columns.target')}</th></tr></thead>
        <tbody>{auditRows.slice(0, 25).map(event => <tr key={event.id} className="border-b border-zinc-100"><td data-label={t('operations.audit.columns.time')} data-primary className="p-2">{date(event.createdAt)}</td><td data-label={t('operations.audit.columns.actor')} className="p-2 font-mono text-xs">{event.actorUserId ?? t('operations.audit.system')}</td><td data-label={t('operations.audit.columns.action')} data-actions className="p-2">{event.action}</td><td data-label={t('operations.audit.columns.target')} data-actions className="p-2 font-mono text-xs">{event.targetType}: {event.targetId ?? none}</td></tr>)}</tbody>
      </AdminResponsiveTable></div>
      <Pagination path="/admin/operations" page={page} hasMore={auditRows.length > 25} />
    </section>
  </div>;
}
