import Link from 'next/link';

function Stars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`Rated ${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          className={`w-5 h-5 ${n <= value ? 'text-accent fill-accent' : 'text-zinc-300 fill-zinc-200'}`}
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
          />
        </svg>
      ))}
    </div>
  );
}

/**
 * Slim trust strip surfacing the salon's review reputation — the 4.9★/80-review
 * standing that previously only existed in JSON-LD. Renders nothing with no reviews.
 */
export function SocialProofBar({ average, count }: { average: number; count: number }) {
  if (!count) return null;
  return (
    <section className="bg-white border-b border-zinc-100" aria-label="Customer reviews">
      <div className="container mx-auto px-4 py-5 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-5 text-center">
        <div className="flex items-center gap-2">
          <Stars value={Math.round(average)} />
          <span className="font-serif text-lg text-zinc-900">{average.toFixed(1)}</span>
        </div>
        <span className="hidden sm:block w-px h-5 bg-zinc-200" aria-hidden="true" />
        <Link
          href="/reviews"
          className="text-sm text-zinc-600 hover:text-accent transition-colors"
        >
          <span className="font-semibold text-zinc-900">{count}</span> verified client reviews
        </Link>
      </div>
    </section>
  );
}
