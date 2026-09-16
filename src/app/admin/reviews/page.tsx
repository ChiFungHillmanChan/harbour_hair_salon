import { requireAdmin } from '@/app/lib/session';
import Link from 'next/link';
import { getReviewsForModeration, type ReviewStatus } from '@/app/services/review-service';
import { moderateReview } from '@/app/actions/reviews';
import { RowActionButton } from '@/components/admin/RowActionButton';
import prisma from '@/app/lib/prisma';

import { pageNumber } from '@/app/lib/pagination';
import { Pagination } from '@/components/admin/Pagination';

export const dynamic = 'force-dynamic';

const TABS: { status: ReviewStatus; label: string; href: string; countClassName: string }[] = [
  { status: 'PENDING', label: 'Pending', href: '/admin/reviews', countClassName: 'text-zinc-900' },
  {
    status: 'APPROVED',
    label: 'Approved',
    href: '/admin/reviews?status=approved',
    countClassName: 'text-emerald-600',
  },
  {
    status: 'REJECTED',
    label: 'Rejected',
    href: '/admin/reviews?status=rejected',
    countClassName: 'text-zinc-600',
  },
];

const EMPTY_MESSAGE: Record<ReviewStatus, string> = {
  PENDING: 'No pending reviews to moderate.',
  APPROVED: 'No approved reviews yet. Approve a pending review to publish it.',
  REJECTED: 'No rejected reviews.',
};

function Stars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          className={`w-4 h-4 ${n <= value ? 'text-zinc-900 fill-zinc-900' : 'text-zinc-300 fill-zinc-200'}`}
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

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  await requireAdmin();
  const { status: requested, page: requestedPage } = await searchParams;
  const page = pageNumber(requestedPage);
  const normalised = (requested ?? '').toUpperCase();
  const activeStatus: ReviewStatus =
    normalised === 'APPROVED' || normalised === 'REJECTED' ? normalised : 'PENDING';

  const [rows, counts] = await Promise.all([
    getReviewsForModeration(activeStatus, 26, page),
    prisma.review.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ]);

  const reviews = rows.slice(0, 25);
  const statusCount = (status: string) =>
    counts.find((c) => c.status === status)?._count._all ?? 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">Reviews</h1>
        <p className="text-zinc-700 mt-2">
          Moderate client reviews. Approved reviews appear on the public reviews page and feed the
          aggregate rating in structured data. Switch view below to unpublish a review you have
          already approved, or to reinstate one you rejected.
        </p>
      </div>

      <nav className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8" aria-label="Review status">
        {TABS.map((tab) => {
          const isActive = tab.status === activeStatus;
          return (
            <Link
              key={tab.status}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={`block bg-white p-5 rounded-lg shadow border transition-colors ${
                isActive
                  ? 'border-zinc-900 ring-1 ring-zinc-900'
                  : 'border-zinc-200 hover:border-zinc-400'
              }`}
            >
              <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">
                {tab.label}
              </p>
              <p className={`text-3xl font-bold mt-1 ${tab.countClassName}`}>
                {statusCount(tab.status)}
              </p>
            </Link>
          );
        })}
      </nav>

      {reviews.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <p className="text-zinc-500">{EMPTY_MESSAGE[activeStatus]}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
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
                  {activeStatus !== 'APPROVED' && (
                    <RowActionButton
                      action={moderateReview.bind(null, review.id, 'APPROVE')}
                      label={activeStatus === 'REJECTED' ? 'Publish' : 'Approve'}
                      pendingLabel="Publishing…"
                      buttonClassName="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2 rounded font-medium transition-colors"
                      confirmMessage="Publish this review on the public reviews page?"
                    />
                  )}
                  {activeStatus !== 'REJECTED' && (
                    <RowActionButton
                      action={moderateReview.bind(null, review.id, 'REJECT')}
                      label={activeStatus === 'APPROVED' ? 'Unpublish' : 'Reject'}
                      pendingLabel={activeStatus === 'APPROVED' ? 'Unpublishing…' : 'Rejecting…'}
                      buttonClassName="bg-zinc-200 hover:bg-zinc-300 text-zinc-700 text-sm px-4 py-2 rounded font-medium transition-colors"
                      confirmMessage={
                        activeStatus === 'APPROVED'
                          ? 'Unpublish this review? It will be removed from the public reviews page and from the aggregate rating.'
                          : 'Reject this review? It stays hidden from the public page.'
                      }
                    />
                  )}
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
      <Pagination path="/admin/reviews" page={page} hasMore={rows.length > 25} query={{ status: activeStatus.toLowerCase() }} />
    </div>
  );
}
