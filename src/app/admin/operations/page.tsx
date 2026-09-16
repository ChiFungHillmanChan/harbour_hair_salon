import { requireAdmin } from '@/app/lib/session';
import Link from 'next/link';
import prisma from '@/app/lib/prisma';
import { pageNumber } from '@/app/lib/pagination';
import { Pagination } from '@/components/admin/Pagination';
import { OPERATIONS_READINESS_JOB, parseOperationsChecks } from '@/app/services/operations-readiness';
import { OperationsControls } from '@/components/admin/OperationsControls';

export const dynamic = 'force-dynamic';

function date(value: Date | null) {
  return value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(value) : 'Never';
}

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const page = pageNumber((await searchParams).page);
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
  return <div className="mx-auto max-w-6xl space-y-7 p-4 sm:p-6 lg:p-8">
    <header>
      <h1 className="text-3xl font-serif font-bold text-zinc-900">Operations</h1>
      <p className="mt-2 text-zinc-600">Connection checks, scheduled jobs and booking notification delivery. Times are shown in London time.</p>
      <div className="mt-3 flex gap-5 text-sm text-[#174F7F]"><Link className="underline" href="/admin/integrations">Calendar integrations</Link><Link className="underline" href="/admin/settings">Booking settings</Link></div>
    </header>
    <OperationsControls notificationsEnabled={process.env.NOTIFICATIONS_ENABLED === 'true'} />
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-zinc-900">Latest readiness report</h2>
      <p className="mt-1 text-sm text-zinc-500">Last run: {date(report?.lastStartedAt ?? null)}. Enabling booking requires a complete passing report from the current settings, less than 24 hours old.</p>
      {checks.length ? <ul className="mt-4 divide-y divide-zinc-100">{checks.map((check) => <li key={check.id} className="py-3">
        <div className="flex items-center gap-3"><span className={`rounded px-2 py-1 text-xs font-semibold uppercase ${check.status === 'pass' ? 'bg-green-50 text-green-800' : check.status === 'fail' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>{check.status}</span><h3 className="font-medium text-zinc-900">{check.label}</h3></div>
        <p className="mt-2 text-sm text-zinc-600">{check.message}</p>
      </li>)}</ul> : <p className="mt-4 text-sm text-zinc-600">No saved report. Run read-only diagnostics to check the current configuration.</p>}
      <p className="mt-4 text-sm text-zinc-600">A passing check does not prove that customers receive emails, that a provider subscribes to your calendar, or that backups can be restored. Complete those acceptance tests with the salon.</p>
    </section>
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-zinc-900">Scheduled jobs</h2>
      {cronJobs.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-zinc-500"><th className="p-2">Job</th><th className="p-2">Started</th><th className="p-2">Succeeded</th><th className="p-2">Failed</th><th className="p-2">Last error</th></tr></thead><tbody>{cronJobs.map((job) => <tr key={job.name} className="border-b border-zinc-100"><td className="p-2 font-medium">{job.name}</td><td className="p-2">{date(job.lastStartedAt)}</td><td className="p-2">{date(job.lastSucceededAt)}</td><td className="p-2">{date(job.lastFailedAt)}</td><td className="max-w-sm break-words p-2">{job.lastError ?? '—'}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-zinc-600">No scheduled job execution has been recorded. Confirm that the deployed schedule is enabled.</p>}
    </section>
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-zinc-900">Recent notification deliveries</h2>
      <p className="mt-2 text-sm text-zinc-600">For old or uncertain failures, reconcile the delivery with Resend before taking further action. Items outside the automatic retry window are not reset here, to avoid duplicate emails.</p>
      {deliveries.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-zinc-500"><th className="p-2">Delivery ID</th><th className="p-2">Type</th><th className="p-2">Status</th><th className="p-2">Attempts</th><th className="p-2">Last error</th></tr></thead><tbody>{deliveries.map((delivery) => <tr key={delivery.id} className="border-b border-zinc-100"><td className="p-2 font-mono text-xs">{delivery.id}</td><td className="p-2">{delivery.kind}</td><td className="p-2">{delivery.status}</td><td className="p-2">{delivery.attempts}</td><td className="max-w-sm break-words p-2">{delivery.lastError ?? '—'}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-zinc-600">No notification deliveries have been queued.</p>}
    </section>
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-zinc-900">Security and administration audit</h2>
      <p className="mt-2 text-sm text-zinc-600">Account, device, payroll and administrative changes. Credentials and customer message content are excluded.</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Time</th><th className="p-2">Actor ID</th><th className="p-2">Action</th><th className="p-2">Target</th></tr></thead>
        <tbody>{auditRows.slice(0, 25).map(event => <tr key={event.id} className="border-b border-zinc-100"><td className="p-2">{date(event.createdAt)}</td><td className="p-2 font-mono text-xs">{event.actorUserId ?? 'System'}</td><td className="p-2">{event.action}</td><td className="p-2 font-mono text-xs">{event.targetType}: {event.targetId ?? '—'}</td></tr>)}</tbody>
      </table></div>
      <Pagination path="/admin/operations" page={page} hasMore={auditRows.length > 25} />
    </section>
  </div>;
}
