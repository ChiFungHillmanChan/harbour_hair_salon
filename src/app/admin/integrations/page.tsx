import Link from 'next/link';
import {
  retryFailedTreatwellBookingsAction,
  runTreatwellIcalSyncAction,
} from '@/app/actions/admin-integrations';
import { getIntegrationReadiness } from '@/app/services/integration-readiness';

export const dynamic = 'force-dynamic';

type SearchParams = {
  ical?: string;
  feeds?: string;
  failed?: string;
  upserted?: string;
  retry?: string;
};

function Status({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
      ready ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
    }`}>
      {children}
    </span>
  );
}

function ConfigRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-zinc-100 py-2 last:border-0">
      <code className="text-xs text-zinc-700">{label}</code>
      <Status ready={ready}>{ready ? 'Configured' : 'Missing'}</Status>
    </li>
  );
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [readiness, query] = await Promise.all([getIntegrationReadiness(), searchParams]);
  const { treatwell, resend, cdn } = readiness;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6 md:p-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#174F7F]">Operations</p>
        <h1 className="mt-2 text-3xl font-serif font-bold text-zinc-900">Integrations</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
          Configuration status only — secret values are never shown. Treatwell API mode stays disabled
          until the official contract and credentials are available.
        </p>
      </div>

      {(query.ical === 'complete' || query.retry) && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {query.ical === 'complete'
            ? `iCal sync finished: ${query.feeds ?? '0'} feed(s), ${query.upserted ?? '0'} event(s), ${query.failed ?? '0'} failure(s).`
            : `${query.retry} failed API booking(s) moved back to the pending queue.`}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-zinc-900">Treatwell</h2>
              <p className="mt-1 text-sm text-zinc-500">Current iCal inbound + future API outbound</p>
            </div>
            <Status ready={treatwell.api.enabled && treatwell.api.configured}>
              {treatwell.api.enabled && treatwell.api.configured ? 'API config ready' : 'API not enabled'}
            </Status>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-zinc-50 p-3"><dt className="text-zinc-500">iCal staff</dt><dd className="mt-1 text-xl font-bold">{treatwell.stylists.icalMapped}/{treatwell.stylists.total}</dd></div>
            <div className="rounded-lg bg-zinc-50 p-3"><dt className="text-zinc-500">API staff mapping</dt><dd className="mt-1 text-xl font-bold">{treatwell.stylists.apiMapped}/{treatwell.stylists.total}</dd></div>
            <div className="rounded-lg bg-zinc-50 p-3"><dt className="text-zinc-500">API service mapping</dt><dd className="mt-1 text-xl font-bold">{treatwell.services.apiMapped}/{treatwell.services.total}</dd></div>
            <div className="rounded-lg bg-zinc-50 p-3"><dt className="text-zinc-500">Last iCal event sync</dt><dd className="mt-1 text-sm font-semibold">{treatwell.lastIcalSyncAt ? treatwell.lastIcalSyncAt.toLocaleString('en-GB') : 'Never'}</dd></div>
          </dl>

          <ul className="mt-5">
            <ConfigRow label="TREATWELL_API_ENABLED=true" ready={treatwell.api.enabled} />
            <ConfigRow label="TREATWELL_API_BASE_URL" ready={treatwell.api.baseUrlConfigured} />
            <ConfigRow label="TREATWELL_API_KEY" ready={treatwell.api.apiKeyConfigured} />
            <ConfigRow label="TREATWELL_VENUE_ID" ready={treatwell.api.venueIdConfigured} />
          </ul>

          <p className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
            Code boundary, database mappings and queue state are ready. The HTTP adapter deliberately
            waits for Treatwell&apos;s official endpoint, auth and webhook documentation.
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <form action={runTreatwellIcalSyncAction}>
              <button className="rounded bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700">
                Run iCal sync now
              </button>
            </form>
            <Link href="/admin/stylists" className="rounded border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
              Map stylists
            </Link>
            <Link href="/admin/services" className="rounded border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
              Map services
            </Link>
          </div>

          <div className="mt-6 border-t border-zinc-200 pt-5">
            <p className="text-sm text-zinc-700">
              Outbound queue: <strong>{treatwell.outbound.pending}</strong> pending,{' '}
              <strong className={treatwell.outbound.failed ? 'text-red-700' : ''}>{treatwell.outbound.failed}</strong> failed,{' '}
              <strong>{treatwell.outbound.synced}</strong> synced.
            </p>
            {treatwell.outbound.failed > 0 && (
              <form action={retryFailedTreatwellBookingsAction} className="mt-3">
                <button className="text-sm font-semibold text-[#174F7F] underline underline-offset-4">
                  Retry all failed bookings
                </button>
              </form>
            )}
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-xl font-semibold">Resend</h2><p className="mt-1 text-sm text-zinc-500">Transactional and marketing email</p></div>
              <Status ready={resend.apiKeyConfigured && resend.fromAddressConfigured}>
                {resend.apiKeyConfigured && resend.fromAddressConfigured ? 'Sending ready' : 'Setup needed'}
              </Status>
            </div>
            <ul className="mt-5">
              <ConfigRow label="RESEND_API_KEY" ready={resend.apiKeyConfigured} />
              <ConfigRow label="EMAIL_FROM" ready={resend.fromAddressConfigured} />
              <ConfigRow label="EMAIL_REPLY_TO" ready={resend.replyToConfigured} />
              <ConfigRow label="RESEND_AUDIENCE_ID" ready={resend.audienceConfigured} />
            </ul>
            <p className="mt-4 text-xs leading-5 text-zinc-500">Verify a Harbour Hair sending domain in Resend, then use an address such as bookings@your-domain.</p>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-xl font-semibold">Vercel CDN</h2><p className="mt-1 text-sm text-zinc-500">ISR public-page delivery</p></div>
              <Status ready={cdn.siteUrlConfigured}>{cdn.siteUrlConfigured ? 'Site URL ready' : 'Domain setting missing'}</Status>
            </div>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-zinc-500">Strategy</dt><dd className="font-semibold">Incremental Static Regeneration</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-zinc-500">Homepage refresh</dt><dd className="font-semibold">Every {cdn.homeRevalidateSeconds / 60} minutes + on-demand</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-zinc-500">Required env</dt><dd className="font-mono text-xs">NEXT_PUBLIC_SITE_URL</dd></div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
