import { requireAdmin } from '@/app/lib/session';
import Link from 'next/link';
import { verifySession } from '@/app/lib/session';
import { retryFailedTreatwellBookingsAction } from '@/app/actions/admin-integrations';
import { getIntegrationReadiness, listCalendarConnectionsForAdmin } from '@/app/services/integration-readiness';
import { CalendarConnectionsSetup } from '@/components/admin/CalendarConnectionsSetup';
import { CALENDAR_FRESHNESS_MINUTES } from '@/app/services/treatwell-sync-coverage';
import { SITE_URL } from '@/app/lib/site-url';

export const dynamic = 'force-dynamic';

type SearchParams = { ical?: string; feeds?: string; failed?: string; skipped?: string; upserted?: string; retry?: string; feedToken?: string; calendar?: string; calendarError?: string };
function ConfigRow({ label, ready }: { label: string; ready: boolean }) {
  return <li className="flex items-center justify-between gap-4 border-b border-zinc-100 py-2 last:border-0"><code className="text-xs text-zinc-700">{label}</code><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ready ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{ready ? 'Configured' : 'Missing'}</span></li>;
}
export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
  const [readiness, stylists, query] = await Promise.all([getIntegrationReadiness(), listCalendarConnectionsForAdmin(SITE_URL), searchParams]);
  const { treatwell, resend, cdn } = readiness;
  const scheduledSyncEnabled = process.env.CALENDAR_SYNC_ENABLED === 'true';
  return <div className="mx-auto max-w-6xl space-y-8 p-6 md:p-10">
    <header><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#174F7F]">Operations</p><h1 className="mt-2 text-3xl font-serif font-bold text-zinc-900">Integrations</h1><p className="mt-2 text-sm leading-6 text-zinc-600">Set up each stylist&apos;s calendar connections, then test the feeds before enabling website booking.</p></header>
    {query.calendarError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Calendar settings were not saved. {query.calendarError.slice(0, 300)}</div>}
    {(query.ical || query.calendar || query.feedToken || query.retry) && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      {query.ical === 'complete' ? `Sync finished: ${query.feeds ?? '0'} feed(s), ${query.upserted ?? '0'} event(s), ${query.failed ?? '0'} failure(s), ${query.skipped ?? '0'} skipped. Check each feed below.` : query.feedToken ? 'Secret URL rotated. Update provider subscriptions and confirm them again.' : query.retry ? `${query.retry} failed API job(s) queued for retry.` : query.calendar === 'confirmed' ? 'Outbound subscription check recorded.' : 'Calendar settings saved. Test changed feeds before enabling website booking.'}
    </div>}
    <section className={`rounded-lg border p-5 ${treatwell.syncCoverage.safeToEnableOnlineBooking ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
      <h2 className="font-semibold">{treatwell.syncCoverage.safeToEnableOnlineBooking ? 'Calendar setup checks pass' : 'Calendar setup needs attention'}</h2>
      {treatwell.syncCoverage.blockers.length > 0 && <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{treatwell.syncCoverage.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
      <p className="mt-3 text-sm leading-6">Calendar feeds are delayed and do not reserve a slot on every platform at once. Review new booking requests against all provider calendars before confirming. <Link href="/admin/opening-hours" className="font-semibold underline">Opening hours</Link> must be complete, and active feeds must have succeeded within {CALENDAR_FRESHNESS_MINUTES} minutes.</p>
    </section>
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-xl font-semibold">Treatwell and Fresha calendar setup</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-600">Use the provider&apos;s supported per-stylist iCal export and external-calendar subscription if available for your account. If either direction is unavailable, leave its setup unconfirmed and keep website booking closed. No private provider API is assumed.</p>
      <p className="mt-3 text-sm leading-6 text-zinc-600">The website imports provider busy times and exports website bookings with a fixed “Busy” title. Imported Treatwell blocks are not forwarded to Fresha, or vice versa, because forwarded events can create calendar loops. Staff must reconcile bookings between the provider calendars.</p>
      <p className="mt-3 text-sm leading-6 text-zinc-600">Feeds must use HTTPS and discrete events with UTC or named time zones. Recurrence rules, redirects and ambiguous feed formats fail the test and retain previous busy times. Successful empty feeds clear canceled busy times.</p>
      <p className="mt-3 rounded bg-zinc-50 p-3 text-sm">{scheduledSyncEnabled ? 'Scheduled inbound sync is enabled. The configured job runs every 30 minutes; provider export and import delays can add to this.' : 'Scheduled inbound sync is off. Manual tests are available below. Enable CALENDAR_SYNC_ENABLED=true in the deployment only after configuring and testing feeds.'}</p>
    </section>
    <CalendarConnectionsSetup stylists={stylists} />
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-zinc-200 bg-white p-6"><h2 className="text-xl font-semibold">Resend email configuration</h2><ul className="mt-4"><ConfigRow label="RESEND_API_KEY" ready={resend.apiKeyConfigured} /><ConfigRow label="EMAIL_FROM" ready={resend.fromAddressConfigured} /><ConfigRow label="EMAIL_REPLY_TO" ready={resend.replyToConfigured} /><ConfigRow label="RESEND_AUDIENCE_ID" ready={resend.audienceConfigured} /></ul><p className="mt-4 text-xs leading-5 text-zinc-500">Configuration alone does not prove delivery. Verify the sending domain in Resend and complete the notification checks before launch.</p></section>
      <section className="rounded-xl border border-zinc-200 bg-white p-6"><h2 className="text-xl font-semibold">Vercel CDN</h2><p className="mt-2 text-sm text-zinc-600">Public pages use incremental static regeneration. Homepage refresh: every {cdn.homeRevalidateSeconds / 60} minutes and on demand.</p><ul className="mt-4"><ConfigRow label="NEXT_PUBLIC_SITE_URL" ready={cdn.siteUrlConfigured} /></ul></section>
    </div>
    <details className="rounded-xl border border-zinc-200 bg-white p-5"><summary className="cursor-pointer font-semibold">Future Treatwell API adapter</summary><p className="mt-3 text-sm leading-6 text-zinc-600">The HTTP adapter remains unavailable until an official API contract is supplied. Environment variables and mappings do not establish a working connection.</p><p className="mt-3 text-sm">Queue: {treatwell.outbound.pending} pending, {treatwell.outbound.failed} failed, {treatwell.outbound.synced} synced.</p>{treatwell.outbound.failed > 0 && <form action={retryFailedTreatwellBookingsAction} className="mt-3"><button className="text-sm font-semibold text-[#174F7F] underline">Retry failed API jobs</button></form>}</details>
  </div>;
}
