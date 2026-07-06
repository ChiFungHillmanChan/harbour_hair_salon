// Instant skeleton shown while an admin route's server component (and its DB
// queries) resolve. Without this, clicking a sidebar link blocks with zero
// feedback until every query finishes — the main cause of the "slow on click"
// feel. The admin sidebar layout stays mounted; only this content area swaps.
export default function AdminLoading() {
  return (
    <div className="p-8 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-8">
        <div className="h-9 w-48 rounded bg-zinc-200" />
        <div className="mt-3 h-4 w-72 rounded bg-zinc-200" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-white p-5 rounded-lg shadow border border-zinc-200"
          >
            <div className="h-4 w-24 rounded bg-zinc-200" />
            <div className="mt-3 h-8 w-12 rounded bg-zinc-200" />
          </div>
        ))}
      </div>

      {/* Main content block */}
      <div className="h-96 rounded-lg border border-zinc-200 bg-white shadow" />
    </div>
  );
}
