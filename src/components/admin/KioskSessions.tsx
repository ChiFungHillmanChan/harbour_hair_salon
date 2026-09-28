import type { listKioskSessions } from '@/app/actions/kiosk';
import { revokeAllKioskSessions, revokeKioskSession } from '@/app/actions/kiosk';
import { RowActionButton } from '@/components/admin/RowActionButton';
import { formatSalonDateTime, formatSalonMediumDate } from '@/i18n/dates';
import { getLocale, getT } from '@/i18n/server';

export default async function KioskSessions({ sessions }: { sessions: Awaited<ReturnType<typeof listKioskSessions>> }) {
  const [locale, t] = await Promise.all([getLocale(), getT('adminStaff')]);
  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-xl text-zinc-900">{t('kioskDevices.title')}</h2>
      <p className="text-sm text-zinc-600">{t('kioskDevices.intro')}</p>
      {sessions.length === 0 ? (
        <p className="text-sm text-zinc-600">{t('kioskDevices.empty')}</p>
      ) : (
        <>
          <ul className="divide-y divide-zinc-100">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-zinc-900">{session.deviceName}</p>
                  <p className="text-xs text-zinc-500">
                    {t('kioskDevices.meta', {
                      enabled: formatSalonDateTime(locale, session.createdAt),
                      expires: formatSalonMediumDate(locale, session.expiresAt),
                    })}
                  </p>
                </div>
                <RowActionButton action={revokeKioskSession.bind(null, session.id)} label={t('kioskDevices.disable')} pendingLabel={t('kioskDevices.disabling')} buttonClassName="rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50" confirmMessage={t('kioskDevices.disableConfirm', { name: session.deviceName })} />
              </li>
            ))}
          </ul>
          {sessions.length === 100 && <p className="text-xs text-zinc-500">{t('kioskDevices.limit')}</p>}
          <RowActionButton action={revokeAllKioskSessions} label={t('kioskDevices.disableAll')} pendingLabel={t('kioskDevices.disabling')} buttonClassName="rounded border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50" confirmMessage={t('kioskDevices.disableAllConfirm')} />
        </>
      )}
    </section>
  );
}
