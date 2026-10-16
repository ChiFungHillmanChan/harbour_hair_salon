import { clearGoogleBusyTime, syncGoogleCalendarNow } from '@/app/actions/admin-google-calendar';
import { operationsMessageKey } from '@/app/services/operations-messages';
import type { GoogleCalendarStatus as Status } from '@/app/services/google-calendar-status';
import { GoogleClearBusyButton } from '@/components/admin/GoogleClearBusyButton';
import { GoogleSyncButton } from '@/components/admin/GoogleSyncButton';
import { formatSalonDateTime } from '@/i18n/dates';
import { getLocale, getT } from '@/i18n/server';

/**
 * Admin → Integrations: whether the Google Calendar sync is on and healthy,
 * "Sync now", and "Clear Google busy time" (offered on or off: it is how the
 * busy time read from Google is removed after the sync is turned off).
 */
export async function GoogleCalendarStatus({ status }: { status: Status }) {
  const [locale, t] = await Promise.all([getLocale(), getT('adminOps')]);
  const never = t('integrations.connections.never');
  const timestamp = (value: Date | null) => (value ? formatSalonDateTime(locale, value) : never);
  // Our own fixed sentences are translated; anything else stays as recorded, marked English.
  const problem = (text: string | null) => {
    if (!text) return t('integrations.google.noError');
    const key = operationsMessageKey(text);
    return key ? t(`operations.messages.${key}`) : <span lang="en">{text}</span>;
  };
  return <section className="rounded-xl border border-zinc-200 bg-white p-5" data-testid="google-calendar-status">
    <h2 className="text-xl font-semibold">{t('integrations.google.title')}</h2>
    <p className="mt-2 text-sm leading-6 text-zinc-600">{t('integrations.google.intro')}</p>
    <p className="mt-3 rounded bg-zinc-50 p-3 text-sm">{status.enabled ? t('integrations.google.on') : t('integrations.google.off')}</p>
    {status.enabled && <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      <dt className="text-zinc-500">{t('integrations.google.calendar')}</dt><dd><code className="text-xs">{status.calendarId}</code></dd>
      <dt className="text-zinc-500">{t('integrations.google.channel')}</dt><dd>{status.channelExpiresAt ? formatSalonDateTime(locale, status.channelExpiresAt) : t('integrations.google.channelNone')}</dd>
      <dt className="text-zinc-500">{t('integrations.google.lastPull')}</dt><dd>{timestamp(status.lastPullAt)}</dd>
      <dt className="text-zinc-500">{t('integrations.google.lastSuccess')}</dt><dd>{timestamp(status.lastPullSuccessAt)}</dd>
      <dt className="text-zinc-500">{t('integrations.google.lastError')}</dt><dd>{problem(status.lastPullError)}</dd>
      <dt className="text-zinc-500">{t('integrations.google.failedEvents')}</dt><dd>{status.failedEvents}</dd>
    </dl>}
    <form action={syncGoogleCalendarNow} className="mt-4">
      <GoogleSyncButton label={t('integrations.google.syncNow')} busy={t('integrations.google.syncing')} disabled={!status.enabled} />
      <p className="mt-2 text-xs leading-5 text-zinc-500">{status.enabled ? t('integrations.google.syncNowHelp') : t('integrations.google.syncNowOff')}</p>
    </form>
    <form action={clearGoogleBusyTime} className="mt-5 border-t border-zinc-100 pt-4">
      <h3 className="text-sm font-semibold">{t('integrations.google.clear.title')}</h3>
      <p className="mb-3 mt-1 text-xs leading-5 text-zinc-500">{status.enabled ? t('integrations.google.clear.helpOn') : t('integrations.google.clear.helpOff')}</p>
      <GoogleClearBusyButton label={t('integrations.google.clear.button')} busy={t('integrations.google.clear.clearing')} confirm={t('integrations.google.clear.confirm')} />
    </form>
  </section>;
}
