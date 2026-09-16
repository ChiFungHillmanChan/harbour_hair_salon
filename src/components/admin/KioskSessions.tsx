import type { listKioskSessions } from '@/app/actions/kiosk';
import { revokeAllKioskSessions, revokeKioskSession } from '@/app/actions/kiosk';
import { RowActionButton } from '@/components/admin/RowActionButton';

export default function KioskSessions({ sessions }: { sessions: Awaited<ReturnType<typeof listKioskSessions>> }) {
  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-xl text-zinc-900">Kiosk devices</h2>
      <p className="text-sm text-zinc-600">Disable a lost or shared device here to stop its access immediately. Each kiosk must be enabled again after 30 days.</p>
      {sessions.length === 0 ? (
        <p className="text-sm text-zinc-600">No active kiosk devices.</p>
      ) : (
        <>
          <ul className="divide-y divide-zinc-100">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-zinc-900">{session.deviceName}</p>
                  <p className="text-xs text-zinc-500">
                    Enabled {session.createdAt.toLocaleString('en-GB', { timeZone: 'Europe/London' })}
                    {' · '}Expires {session.expiresAt.toLocaleDateString('en-GB', { timeZone: 'Europe/London' })}
                  </p>
                </div>
                <RowActionButton action={revokeKioskSession.bind(null, session.id)} label="Disable device" pendingLabel="Disabling…" buttonClassName="rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50" confirmMessage={`Disable kiosk access for ${session.deviceName}?`} />
              </li>
            ))}
          </ul>
          {sessions.length === 100 && <p className="text-xs text-zinc-500">Showing the latest 100 active devices. Disable all applies to every device.</p>}
          <RowActionButton action={revokeAllKioskSessions} label="Disable all kiosks" pendingLabel="Disabling…" buttonClassName="rounded border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50" confirmMessage="Disable every kiosk device? Each will need an administrator to enable it again." />
        </>
      )}
    </section>
  );
}
