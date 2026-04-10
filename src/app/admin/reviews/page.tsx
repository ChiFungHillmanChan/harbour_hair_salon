import { getPendingReviews } from '@/app/services/review-service';
import { moderateReview } from '@/app/actions/reviews';
import prisma from '@/app/lib/prisma';

export const dynamic = 'force-dynamic';

function Stars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
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

export default async function AdminReviewsPage() {
  const [pending, counts] = await Promise.all([
    getPendingReviews(),
    prisma.review.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ]);

  const statusCount = (status: string) =>
    counts.find((c) => c.status === status)?._count._all ?? 0;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">Reviews</h1>
        <p className="text-zinc-700 mt-2">
          Moderate client reviews. Approved reviews appear on the public reviews page and feed the
          aggregate rating in structured data.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">Pending</p>
          <p className="text-3xl font-bold text-amber-600 mt-1">{statusCount('PENDING')}</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">Approved</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">{statusCount('APPROVED')}</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">Rejected</p>
          <p className="text-3xl font-bold text-zinc-600 mt-1">{statusCount('REJECTED')}</p>
        </div>
      </div>

      {pending.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <p className="text-zinc-500">No pending reviews to moderate.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((review) => (
            <div
              key={review.id}
              className="bg-white border border-zinc-200 rounded-lg p-6 shadow-sm"
            >
              <div className="flex items-start justify-between mb-4 gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <Stars value={review.rating} />
                    <span className="text-sm text-zinc-500">
                      {review.rating} / 5
                    </span>
                  </div>
                  <p className="font-medium text-zinc-900">
                    {review.user.name || 'Anonymous client'}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">{review.user.email}</p>
                  <p className="text-xs text-zinc-400 mt-1">
                    {review.appointment.service.name} · {review.appointment.stylist.name} ·{' '}
                    {review.createdAt.toLocaleDateString('en-GB')}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <form action={moderateReview}>
                    <input type="hidden" name="reviewId" value={review.id} />
                    <input type="hidden" name="action" value="APPROVE" />
                    <button
                      type="submit"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2 rounded font-medium transition-colors"
                    >
                      Approve
                    </button>
                  </form>
                  <form action={moderateReview}>
                    <input type="hidden" name="reviewId" value={review.id} />
                    <input type="hidden" name="action" value="REJECT" />
                    <button
                      type="submit"
                      className="bg-zinc-200 hover:bg-zinc-300 text-zinc-700 text-sm px-4 py-2 rounded font-medium transition-colors"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              </div>
              {review.comment && (
                <p className="text-zinc-700 font-light leading-relaxed border-t border-zinc-100 pt-4">
                  &ldquo;{review.comment}&rdquo;
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
