import { syncGoogleCalendarNow } from '@/app/actions/admin-google-calendar';
import { operationsMessageKey } from '@/app/services/operations-messages';
import type { GoogleCalendarStatus as Status } from '@/app/services/google-calendar-status';
import { formatSalonDateTime } from '@/i18n/dates';
import { getLocale, getT } from '@/i18n/server';

const button = 'rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50';

/** Admin → Integrations: whether the Google Calendar sync is on and healthy, and "Sync now". */
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
      <button className={button} disabled={!status.enabled}>{t('integrations.google.syncNow')}</button>
      <p className="mt-2 text-xs leading-5 text-zinc-500">{status.enabled ? t('integrations.google.syncNowHelp') : t('integrations.google.syncNowOff')}</p>
    </form>
  </section>;
}
