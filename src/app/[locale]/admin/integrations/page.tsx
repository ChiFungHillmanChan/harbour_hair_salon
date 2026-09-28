import { requireAdmin } from '@/app/lib/session';
import Link from '@/i18n/link';
import { verifySession } from '@/app/lib/session';
import { retryFailedTreatwellBookingsAction } from '@/app/actions/admin-integrations';
import { getIntegrationReadiness, listCalendarConnectionsForAdmin } from '@/app/services/integration-readiness';
import { CalendarConnectionsSetup } from '@/components/admin/CalendarConnectionsSetup';
import { CALENDAR_FRESHNESS_MINUTES } from '@/app/services/treatwell-sync-coverage';
import { SITE_URL } from '@/app/lib/site-url';
import { getT } from '@/i18n/server';
import { rich } from '@/i18n/rich';

export const dynamic = 'force-dynamic';

type SearchParams = { ical?: string; feeds?: string; failed?: string; skipped?: string; upserted?: string; retry?: string; feedToken?: string; calendar?: string; calendarError?: string };
function ConfigRow({ label, ready, readyText, missingText }: { label: string; ready: boolean; readyText: string; missingText: string }) {
  return <li className="flex items-center justify-between gap-4 border-b border-zinc-100 py-2 last:border-0"><code className="text-xs text-zinc-700">{label}</code><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ready ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{ready ? readyText : missingText}</span></li>;
}
export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
  const [readiness, stylists, query, t] = await Promise.all([getIntegrationReadiness(), listCalendarConnectionsForAdmin(SITE_URL), searchParams, getT('adminOps')]);
  const { treatwell, resend, cdn } = readiness;
  // Each setup check has a code (issues[i] matches blockers[i]); a check
  // without one is shown in its English wording and marked as English.
  const englishLang = t.locale === 'en-GB' ? undefined : 'en';
  const { blockers, issues } = treatwell.syncCoverage;
  const setupChecks = blockers.map((blocker, index) => {
    const issue = issues.length === blockers.length ? issues[index] : undefined;
    if (!issue) return { key: `${index}:${blocker}`, text: blocker, lang: englishLang };
    // Coded wording is the detail only; this list has no headings, so the
    // stylist (and provider) go in front, as in the English blocker.
    const detail = t.dynamic(`readiness.calendar.${issue.code}`, issue.params, blocker);
    const text = !issue.params
      ? detail
      : issue.params.provider
        ? t('integrations.checkForProvider', { stylist: issue.params.stylist, provider: issue.params.provider, detail })
        : t('integrations.checkForStylist', { stylist: issue.params.stylist, detail });
    return { key: `${index}:${blocker}`, text, lang: undefined };
  });
  const scheduledSyncEnabled = process.env.CALENDAR_SYNC_ENABLED === 'true';
  const config = (label: string, ready: boolean) => <ConfigRow label={label} ready={ready} readyText={t('integrations.config.configured')} missingText={t('integrations.config.missing')} />;
  // The action redirects with a stable code; anything else (an old bookmarked
  // link) gets the general advice.
  const calendarErrorCode = query.calendarError && /^[A-Z_]{1,40}$/.test(query.calendarError) ? query.calendarError : 'INVALID_INPUT';
  return <div className="mx-auto max-w-6xl space-y-8 p-6 md:p-10">
    <header><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#174F7F]">{t('integrations.eyebrow')}</p><h1 className="mt-2 text-3xl font-serif font-bold text-zinc-900">{t('integrations.title')}</h1><p className="mt-2 text-sm leading-6 text-zinc-600">{t('integrations.intro')}</p></header>
    {query.calendarError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t('integrations.calendarError', { reason: t.dynamic(`integrations.calendarErrors.${calendarErrorCode}`, undefined, t('integrations.calendarErrors.INVALID_INPUT')) })}</div>}
    {(query.ical || query.calendar || query.feedToken || query.retry) && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      {query.ical === 'complete'
        ? t('integrations.status.syncComplete', { feeds: query.feeds ?? '0', upserted: query.upserted ?? '0', failed: query.failed ?? '0', skipped: query.skipped ?? '0' })
        : query.feedToken
          ? t('integrations.status.tokenRotated')
          : query.retry
            ? t('integrations.status.retryQueued', { count: query.retry })
            : query.calendar === 'confirmed'
              ? t('integrations.status.outboundConfirmed')
              : t('integrations.status.saved')}
    </div>}
    <section className={`rounded-lg border p-5 ${treatwell.syncCoverage.safeToEnableOnlineBooking ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
      <h2 className="font-semibold">{treatwell.syncCoverage.safeToEnableOnlineBooking ? t('integrations.coverage.pass') : t('integrations.coverage.attention')}</h2>
      {setupChecks.length > 0 && <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{setupChecks.map((check) => <li key={check.key} lang={check.lang}>{check.text}</li>)}</ul>}
      <p className="mt-3 text-sm leading-6">{rich(t('integrations.coverage.note', { minutes: CALENDAR_FRESHNESS_MINUTES }), {
        link: (text) => <Link href="/admin/opening-hours" className="font-semibold underline">{text}</Link>,
      })}</p>
    </section>
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-xl font-semibold">{t('integrations.setup.title')}</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-600">{t('integrations.setup.direction')}</p>
      <p className="mt-3 text-sm leading-6 text-zinc-600">{t('integrations.setup.loops')}</p>
      <p className="mt-3 text-sm leading-6 text-zinc-600">{t('integrations.setup.format')}</p>
      <p className="mt-3 rounded bg-zinc-50 p-3 text-sm">{scheduledSyncEnabled ? t('integrations.setup.scheduledOn') : t('integrations.setup.scheduledOff')}</p>
    </section>
    <CalendarConnectionsSetup stylists={stylists} />
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-zinc-200 bg-white p-6"><h2 className="text-xl font-semibold">{t('integrations.resend.title')}</h2><ul className="mt-4">{config('RESEND_API_KEY', resend.apiKeyConfigured)}{config('EMAIL_FROM', resend.fromAddressConfigured)}{config('EMAIL_REPLY_TO', resend.replyToConfigured)}{config('RESEND_AUDIENCE_ID', resend.audienceConfigured)}</ul><p className="mt-4 text-xs leading-5 text-zinc-500">{t('integrations.resend.note')}</p></section>
      <section className="rounded-xl border border-zinc-200 bg-white p-6"><h2 className="text-xl font-semibold">{t('integrations.cdn.title')}</h2><p className="mt-2 text-sm text-zinc-600">{t('integrations.cdn.note', { minutes: cdn.homeRevalidateSeconds / 60 })}</p><ul className="mt-4">{config('NEXT_PUBLIC_SITE_URL', cdn.siteUrlConfigured)}</ul></section>
    </div>
    <details className="rounded-xl border border-zinc-200 bg-white p-5"><summary className="cursor-pointer font-semibold">{t('integrations.api.summary')}</summary><p className="mt-3 text-sm leading-6 text-zinc-600">{t('integrations.api.note')}</p><p className="mt-3 text-sm">{t('integrations.api.queue', { pending: treatwell.outbound.pending, failed: treatwell.outbound.failed, synced: treatwell.outbound.synced })}</p>{treatwell.outbound.failed > 0 && <form action={retryFailedTreatwellBookingsAction} className="mt-3"><button className="text-sm font-semibold text-[#174F7F] underline">{t('integrations.api.retry')}</button></form>}</details>
  </div>;
}
