import { getT } from '@/i18n/server';

// Instant skeleton shown while an admin route's server component (and its DB
// queries) resolve. Without this, clicking a sidebar link blocks with zero
// feedback until every query finishes — the main cause of the "slow on click"
// feel. The admin sidebar layout stays mounted; only this content area swaps.
export default async function AdminLoading() {
  const t = await getT('common');
  return (
    <div className="p-3 sm:p-6 lg:p-8 animate-pulse" aria-busy="true" aria-label={t('states.loading')}>
      <div className="mb-4 sm:mb-8">
        <div className="h-8 w-48 max-w-full rounded bg-zinc-200" />
        <div className="mt-3 h-4 w-72 max-w-full rounded bg-zinc-200" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="min-w-0 bg-white p-2 sm:p-5 rounded-lg border border-zinc-200"
          >
            <div className="h-4 w-24 max-w-full rounded bg-zinc-200" />
            <div className="mt-2 h-6 w-12 max-w-full rounded bg-zinc-200 sm:h-8" />
          </div>
        ))}
      </div>

      {/* Main content block */}
      <div className="h-96 rounded-lg border border-zinc-200 bg-white shadow" />
    </div>
  );
}
