import { getT } from '@/i18n/server';

// Instant skeleton for /appointments while the session check + appointment query
// resolve, so a tap gives immediate feedback instead of a frozen previous page.
export default async function AppointmentsLoading() {
  const t = await getT('common');
  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10" aria-busy="true" aria-label={t('states.loadingAppointments')}>
      <div className="max-w-2xl mx-auto animate-pulse">
        <div className="h-8 w-48 rounded bg-zinc-200 mb-8" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 rounded-lg bg-white border border-zinc-200 shadow" />
          ))}
        </div>
      </div>
    </div>
  );
}
