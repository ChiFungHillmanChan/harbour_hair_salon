import { requireAdmin } from '@/app/lib/session';
import Link from '@/i18n/link';
import prisma from '@/app/lib/prisma';
import { pageNumber } from '@/app/lib/pagination';
import { Pagination } from '@/components/admin/Pagination';
import { OPERATIONS_READINESS_JOB, parseOperationsChecks } from '@/app/services/operations-readiness';
import { OperationsControls } from '@/components/admin/OperationsControls';
import { formatSalonDateTime } from '@/i18n/dates';
import { getLocale, getT } from '@/i18n/server';

export const dynamic = 'force-dynamic';

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const [query, locale, t] = await Promise.all([searchParams, getLocale(), getT('adminOps')]);
  const page = pageNumber(query.page);
  const date = (value: Date | null) => value ? formatSalonDateTime(locale, value) : t('operations.never');
  // Metadata only: never select recipients, notification payloads or tokens.
  const [jobs, deliveries, auditRows] = await Promise.all([
    prisma.backgroundJobState.findMany({ orderBy: { name: 'asc' }, select: {
      name: true, lastStartedAt: true, lastSucceededAt: true, lastFailedAt: true, lastError: true, lastResultJson: true,
    } }),
    prisma.notificationDelivery.findMany({ orderBy: { createdAt: 'desc' }, take: 30,
      select: { id: true, kind: true, status: true, attempts: true, lastError: true } }),
    prisma.auditEvent.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 26, skip: (page - 1) * 25,
      select: { id: true, actorUserId: true, action: true, targetType: true, targetId: true, createdAt: true } }),
  ]);
  const report = jobs.find((job) => job.name === OPERATIONS_READINESS_JOB);
  const checks = parseOperationsChecks(report?.lastResultJson).filter((check) => check.id !== 'configuration');
  const cronJobs = jobs.filter((job) => job.name !== OPERATIONS_READINESS_JOB);
  const none = t('operations.none');
  // Job names, error text, delivery IDs and audit action codes are raw
  // diagnostics and stay exactly as recorded.
  return <div className="mx-auto max-w-6xl space-y-7 p-4 sm:p-6 lg:p-8">
    <header>
      <h1 className="text-3xl font-serif font-bold text-zinc-900">{t('operations.title')}</h1>
      <p className="mt-2 text-zinc-600">{t('operations.intro')}</p>
      <div className="mt-3 flex gap-5 text-sm text-[#174F7F]"><Link className="underline" href="/admin/integrations">{t('operations.links.integrations')}</Link><Link className="underline" href="/admin/settings">{t('operations.links.settings')}</Link></div>
    </header>
    <OperationsControls notificationsEnabled={process.env.NOTIFICATIONS_ENABLED === 'true'} />
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-zinc-900">{t('operations.report.title')}</h2>
      <p className="mt-1 text-sm text-zinc-500">{t('operations.report.lastRun', { time: date(report?.lastStartedAt ?? null) })}</p>
      {checks.length ? <ul className="mt-4 divide-y divide-zinc-100">{checks.map((check) => <li key={check.id} className="py-3">
        <div className="flex items-center gap-3"><span className={`rounded px-2 py-1 text-xs font-semibold uppercase ${check.status === 'pass' ? 'bg-green-50 text-green-800' : check.status === 'fail' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>{t.dynamic(`operations.checkStatus.${check.status}`, undefined, check.status)}</span><h3 className="font-medium text-zinc-900">{t.dynamic(`readiness.labels.${check.id}`, undefined, check.label)}</h3></div>
        {/* Reports saved before checks carried a code are shown as saved (English). */}
        <p className="mt-2 text-sm text-zinc-600" lang={check.code ? undefined : 'en'}>{check.code ? t.dynamic(`readiness.operations.${check.code}`, check.params, check.message) : check.message}</p>
      </li>)}</ul> : <p className="mt-4 text-sm text-zinc-600">{t('operations.report.empty')}</p>}
      <p className="mt-4 text-sm text-zinc-600">{t('operations.report.caveat')}</p>
    </section>
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-zinc-900">{t('operations.jobs.title')}</h2>
      {cronJobs.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-zinc-500"><th className="p-2">{t('operations.jobs.columns.job')}</th><th className="p-2">{t('operations.jobs.columns.started')}</th><th className="p-2">{t('operations.jobs.columns.succeeded')}</th><th className="p-2">{t('operations.jobs.columns.failed')}</th><th className="p-2">{t('operations.jobs.columns.lastError')}</th></tr></thead><tbody>{cronJobs.map((job) => <tr key={job.name} className="border-b border-zinc-100"><td className="p-2 font-medium">{job.name}</td><td className="p-2">{date(job.lastStartedAt)}</td><td className="p-2">{date(job.lastSucceededAt)}</td><td className="p-2">{date(job.lastFailedAt)}</td><td className="max-w-sm break-words p-2">{job.lastError ?? none}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-zinc-600">{t('operations.jobs.empty')}</p>}
    </section>
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-zinc-900">{t('operations.deliveries.title')}</h2>
      <p className="mt-2 text-sm text-zinc-600">{t('operations.deliveries.intro')}</p>
      {deliveries.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-zinc-500"><th className="p-2">{t('operations.deliveries.columns.id')}</th><th className="p-2">{t('operations.deliveries.columns.type')}</th><th className="p-2">{t('operations.deliveries.columns.status')}</th><th className="p-2">{t('operations.deliveries.columns.attempts')}</th><th className="p-2">{t('operations.deliveries.columns.lastError')}</th></tr></thead><tbody>{deliveries.map((delivery) => <tr key={delivery.id} className="border-b border-zinc-100"><td className="p-2 font-mono text-xs">{delivery.id}</td><td className="p-2">{t.dynamic(`operations.deliveries.kind.${delivery.kind}`, undefined, delivery.kind)}</td><td className="p-2">{t.dynamic(`operations.deliveries.status.${delivery.status}`, undefined, delivery.status)}</td><td className="p-2">{delivery.attempts}</td><td className="max-w-sm break-words p-2">{delivery.lastError ?? none}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-zinc-600">{t('operations.deliveries.empty')}</p>}
    </section>
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-zinc-900">{t('operations.audit.title')}</h2>
      <p className="mt-2 text-sm text-zinc-600">{t('operations.audit.intro')}</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">{t('operations.audit.columns.time')}</th><th className="p-2">{t('operations.audit.columns.actor')}</th><th className="p-2">{t('operations.audit.columns.action')}</th><th className="p-2">{t('operations.audit.columns.target')}</th></tr></thead>
        <tbody>{auditRows.slice(0, 25).map(event => <tr key={event.id} className="border-b border-zinc-100"><td className="p-2">{date(event.createdAt)}</td><td className="p-2 font-mono text-xs">{event.actorUserId ?? t('operations.audit.system')}</td><td className="p-2">{event.action}</td><td className="p-2 font-mono text-xs">{event.targetType}: {event.targetId ?? none}</td></tr>)}</tbody>
      </table></div>
      <Pagination path="/admin/operations" page={page} hasMore={auditRows.length > 25} />
    </section>
  </div>;
}
