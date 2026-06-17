import type { Metadata } from 'next';
import { jsonLdScript } from '@/app/lib/json-ld';
import Link from 'next/link';
import { getApprovedReviews, getAggregateRating } from '@/app/services/review-service';
import { SITE_URL } from '@/app/lib/site-url';

export const metadata: Metadata = {
  title: 'Client Reviews',
  description:
    'Read verified reviews from Harbour Hair Salon clients in Leeds. See what our customers say about our Hong Kong trained stylists, cuts, colours and treatments.',
  alternates: { canonical: '/reviews' },
  openGraph: {
    title: 'Client Reviews | Harbour Hair Salon Leeds',
    description:
      'Verified client reviews for Harbour Hair Salon in Leeds city centre.',
  },
};

export const revalidate = 1800;

function formatDate(date: Date) {
  return date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
  });
}

function Stars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`Rated ${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          className={`w-4 h-4 ${n <= value ? 'text-accent fill-accent' : 'text-zinc-300 fill-zinc-200'}`}
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

export default async function ReviewsPage() {
  const [reviews, agg] = await Promise.all([
    getApprovedReviews(60),
    getAggregateRating(),
  ]);

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Reviews', item: `${SITE_URL}/reviews` },
    ],
  };

  const reviewsSchema = reviews.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'HairSalon',
        name: 'Harbour Hair Salon',
        url: SITE_URL,
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: agg.average,
          reviewCount: agg.count,
          bestRating: 5,
          worstRating: 1,
        },
        review: reviews.slice(0, 20).map((r) => ({
          '@type': 'Review',
          reviewRating: {
            '@type': 'Rating',
            ratingValue: r.rating,
            bestRating: 5,
            worstRating: 1,
          },
          author: {
            '@type': 'Person',
            name: r.user.name || 'Harbour Hair client',
          },
          datePublished: r.createdAt.toISOString(),
          reviewBody: r.comment || `${r.appointment.service.name} at Harbour Hair Salon.`,
        })),
      }
    : null;

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbSchema) }}
      />
      {reviewsSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(reviewsSchema) }}
        />
      )}

      <section className="relative py-24 bg-zinc-900 text-white">
        <div className="container mx-auto px-4 text-center">
          <div className="w-12 h-[2px] bg-accent mx-auto mb-6" />
          <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-tight">
            Client <span className="italic text-zinc-400">Reviews</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed">
            Honest feedback from the people who sit in our chairs.
          </p>
          {agg.count > 0 && (
            <div className="mt-10 inline-flex items-center gap-4 bg-white/5 border border-white/10 rounded-full px-6 py-3">
              <Stars value={Math.round(agg.average)} />
              <span className="text-white font-medium">
                {agg.average.toFixed(1)} / 5
              </span>
              <span className="text-zinc-400 text-sm">
                from {agg.count} verified review{agg.count === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
      </section>

      <div className="container mx-auto px-4 py-20 max-w-5xl">
        {reviews.length === 0 ? (
          <div className="text-center py-20 border border-zinc-100 rounded-lg bg-zinc-50 max-w-2xl mx-auto">
            <h2 className="text-2xl font-serif text-zinc-700 mb-3">
              Your review could be our first
            </h2>
            <p className="text-zinc-500 font-light mb-8">
              We&apos;re just getting started collecting feedback. If you&apos;ve visited us,
              we&apos;d love to hear about your experience.
            </p>
            <Link
              href="/appointments"
              className="inline-block bg-accent text-black px-10 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-accent-light transition-all"
            >
              Review a past appointment
            </Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-8">
            {reviews.map((r) => (
              <article
                key={r.id}
                className="bg-white border border-zinc-200 rounded-2xl p-7 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="font-medium text-zinc-900">
                      {r.user.name || 'Harbour Hair client'}
                    </p>
                    <p className="text-xs text-zinc-500 uppercase tracking-wider mt-1">
                      {formatDate(r.createdAt)}
                    </p>
                  </div>
                  <Stars value={r.rating} />
                </div>
                {r.comment && (
                  <p className="text-zinc-600 font-light leading-relaxed mb-4">
                    &ldquo;{r.comment}&rdquo;
                  </p>
                )}
                <p className="text-xs text-zinc-400 border-t border-zinc-100 pt-3">
                  {r.appointment.service.name} · {r.appointment.stylist.name}
                </p>
              </article>
            ))}
          </div>
        )}

        <div className="mt-20 text-center">
          <Link
            href="/book"
            className="inline-block bg-accent text-black px-12 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-accent-light transition-all"
          >
            Book Your Visit
          </Link>
        </div>
      </div>
    </div>
  );
}
