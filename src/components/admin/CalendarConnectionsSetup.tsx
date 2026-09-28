import {
  saveCalendarConnectionAction, runCalendarIcalSyncAction,
  confirmCalendarOutboundAction, generateStylistIcalFeedTokenAction,
} from '@/app/actions/admin-integrations';
import type { listCalendarConnectionsForAdmin } from '@/app/services/integration-readiness';
import { CALENDAR_PROVIDERS } from '@/app/services/treatwell-sync-coverage';
import { DraftForm } from '@/components/admin/DraftForm';
import { formatSalonDateTime } from '@/i18n/dates';
import { getLocale, getT } from '@/i18n/server';

type Props = { stylists: Awaited<ReturnType<typeof listCalendarConnectionsForAdmin>> };
const button = 'rounded bg-[#174F7F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#123e64] disabled:opacity-50';
const secondary = 'rounded border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50';

export async function CalendarConnectionsSetup({ stylists }: Props) {
  const [locale, t] = await Promise.all([getLocale(), getT('adminOps')]);
  const timestamp = (value: Date | null | undefined) =>
    value ? formatSalonDateTime(locale, value) : t('integrations.connections.never');
  return <div className="space-y-6">
    {stylists.map((stylist) => <section key={stylist.id} className="rounded-xl border border-zinc-200 bg-white p-5">
      <h3 className="text-xl font-semibold text-zinc-900">{stylist.name}</h3>
      <div className="mt-4 rounded-lg bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-semibold">{t('integrations.connections.outboundTitle')}</h4>
          <form action={generateStylistIcalFeedTokenAction}>
            <input type="hidden" name="stylistId" value={stylist.id} />
            <button className={secondary}>{stylist.feedUrl ? t('integrations.connections.rotate') : t('integrations.connections.generate')}</button>
          </form>
        </div>
        <p className="mt-2 text-sm leading-6 text-zinc-600">{t('integrations.connections.outboundHelp')}</p>
        {stylist.feedUrl && <code className="mt-3 block overflow-x-auto whitespace-nowrap rounded border border-zinc-200 bg-white p-2 text-xs">{stylist.feedUrl}</code>}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {CALENDAR_PROVIDERS.map((provider) => {
          const connection = stylist.connections.find((entry) => entry.provider === provider);
          const label = provider === 'TREATWELL' ? 'Treatwell' : 'Fresha';
          return <div key={provider} className="rounded-lg border border-zinc-200 p-4">
            <h4 className="text-lg font-semibold">{label}</h4>
            {/* Unsaved ticks survive a language switch; the private feed URL is never kept. */}
            <DraftForm draftKey={`calendar-connection:${stylist.id}:${provider}`} action={saveCalendarConnectionAction} className="mt-3 space-y-3">
              <input type="hidden" name="stylistId" value={stylist.id} />
              <input type="hidden" name="provider" value={provider} />
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="receivesBookings" defaultChecked={connection?.receivesBookings ?? false} className="mt-1" /><span>{t('integrations.connections.receivesBookings', { name: stylist.name })}<span className="mt-1 block text-xs text-zinc-500">{t('integrations.connections.receivesBookingsHelp')}</span></span></label>
              <label className="block text-sm font-medium">{t('integrations.connections.inboundLabel')}
                <input type="url" name="inboundUrl" autoComplete="off" data-no-preserve placeholder={connection?.inboundUrlConfigured ? t('integrations.connections.inboundSavedPlaceholder') : 'https://…'} className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 font-normal" />
              </label>
              {connection?.inboundUrlConfigured && <label className="flex items-center gap-2 text-xs text-zinc-600"><input type="checkbox" name="clearInboundUrl" />{t('integrations.connections.clearInbound')}</label>}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inboundEnabled" defaultChecked={connection?.inboundEnabled ?? false} />{t('integrations.connections.inboundEnabled')}</label>
              <button className={button}>{t('integrations.connections.save', { provider: label })}</button>
            </DraftForm>
            <dl className="mt-4 space-y-1 text-xs text-zinc-600">
              <div className="flex justify-between gap-3"><dt>{t('integrations.connections.lastAttempt')}</dt><dd>{timestamp(connection?.lastAttemptAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt>{t('integrations.connections.lastSuccess')}</dt><dd>{timestamp(connection?.lastSuccessAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt>{t('integrations.connections.outboundConfirmed')}</dt><dd>{timestamp(connection?.outboundConfirmedAt)}</dd></div>
            </dl>
            {/* Raw sync diagnostic from the provider feed, shown as recorded. */}
            {connection?.lastError && <p role="alert" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-800">{connection.lastError}</p>}
            <form action={runCalendarIcalSyncAction} className="mt-3">
              <input type="hidden" name="connectionId" value={connection?.id ?? ''} />
              <button className={secondary} disabled={!connection?.inboundEnabled || !connection?.inboundUrlConfigured}>{t('integrations.connections.testSync')}</button>
            </form>
            <form action={confirmCalendarOutboundAction} className="mt-4 border-t border-zinc-100 pt-4">
              <input type="hidden" name="stylistId" value={stylist.id} />
              <input type="hidden" name="provider" value={provider} />
              <input type="hidden" name="token" value={stylist.feedToken ?? ''} />
              <label className="flex items-start gap-2 text-xs leading-5 text-zinc-600"><input type="checkbox" name="confirmed" required disabled={!stylist.feedToken} className="mt-1" /><span>{t('integrations.connections.confirmCheckbox', { provider: label })}</span></label>
              <button className={`${secondary} mt-2`} disabled={!stylist.feedToken}>{t('integrations.connections.confirmButton')}</button>
            </form>
          </div>;
        })}
      </div>
    </section>)}
  </div>;
}
