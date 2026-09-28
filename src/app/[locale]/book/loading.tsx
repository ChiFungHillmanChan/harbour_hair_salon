import { getT } from '@/i18n/server';

// Instant skeleton for /book (force-dynamic: a settings read, a session check
// and several queries run before the first byte). Without it, tapping "Book"
// during a Neon cold start left the previous page on screen with no feedback,
// so visitors tapped again or assumed the site was broken.
export default async function BookLoading() {
  const t = await getT('common');
  return (
    <div className="min-h-screen bg-zinc-50" aria-busy="true" aria-label={t('states.loadingBooking')}>
      <div className="py-14 md:py-24 bg-zinc-900" />
      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-3xl mx-auto animate-pulse">
          <div className="h-8 w-56 rounded bg-zinc-200 mb-6" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 rounded-lg bg-white border border-zinc-200" />
            ))}
          </div>
          <div className="h-64 rounded-lg bg-white border border-zinc-200" />
        </div>
      </div>
    </div>
  );
}
