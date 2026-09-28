import { requireAdmin } from '@/app/lib/session';
import Link from '@/i18n/link';
import { getReviewsForModeration, type ReviewStatus } from '@/app/services/review-service';
import { moderateReview } from '@/app/actions/reviews';
import { RowActionButton } from '@/components/admin/RowActionButton';
import prisma from '@/app/lib/prisma';

import { pageNumber } from '@/app/lib/pagination';
import { Pagination } from '@/components/admin/Pagination';
import { formatSalonMediumDate } from '@/i18n/dates';
import { getLocale, getT } from '@/i18n/server';

export const dynamic = 'force-dynamic';

const TABS: { status: ReviewStatus; href: string; countClassName: string }[] = [
  { status: 'PENDING', href: '/admin/reviews', countClassName: 'text-zinc-900' },
  {
    status: 'APPROVED',
    href: '/admin/reviews?status=approved',
    countClassName: 'text-emerald-600',
  },
  {
    status: 'REJECTED',
    href: '/admin/reviews?status=rejected',
    countClassName: 'text-zinc-600',
  },
];

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

/** Customer names, emails and review text are shown exactly as written; only the labels around them are translated. */
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

  const [rows, counts, locale, t] = await Promise.all([
    getReviewsForModeration(activeStatus, 26, page),
    prisma.review.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    getLocale(),
    getT('adminContent'),
  ]);

  const reviews = rows.slice(0, 25);
  const statusCount = (status: string) =>
    counts.find((c) => c.status === status)?._count._all ?? 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">{t('reviews.title')}</h1>
        <p className="text-zinc-700 mt-2">{t('reviews.intro')}</p>
      </div>

      <nav className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8" aria-label={t('reviews.tabsLabel')}>
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
                {t.dynamic(`reviews.tabs.${tab.status}`)}
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
          <p className="text-zinc-500">{t.dynamic(`reviews.empty.${activeStatus}`)}</p>
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
                      {t('reviews.rating', { rating: review.rating })}
                    </span>
                  </div>
                  <p className="font-medium text-zinc-900">
                    {review.user.name || t('reviews.anonymous')}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">{review.user.email}</p>
                  <p className="text-xs text-zinc-400 mt-1">
                    {review.appointment.service.name} · {review.appointment.stylist.name} ·{' '}
                    {formatSalonMediumDate(locale, review.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {activeStatus !== 'APPROVED' && (
                    <RowActionButton
                      action={moderateReview.bind(null, review.id, 'APPROVE')}
                      label={activeStatus === 'REJECTED' ? t('reviews.actions.publish') : t('reviews.actions.approve')}
                      pendingLabel={t('reviews.actions.publishing')}
                      buttonClassName="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2 rounded font-medium transition-colors"
                      confirmMessage={t('reviews.actions.publishConfirm')}
                    />
                  )}
                  {activeStatus !== 'REJECTED' && (
                    <RowActionButton
                      action={moderateReview.bind(null, review.id, 'REJECT')}
                      label={activeStatus === 'APPROVED' ? t('reviews.actions.unpublish') : t('reviews.actions.reject')}
                      pendingLabel={activeStatus === 'APPROVED' ? t('reviews.actions.unpublishing') : t('reviews.actions.rejecting')}
                      buttonClassName="bg-zinc-200 hover:bg-zinc-300 text-zinc-700 text-sm px-4 py-2 rounded font-medium transition-colors"
                      confirmMessage={
                        activeStatus === 'APPROVED'
                          ? t('reviews.actions.unpublishConfirm')
                          : t('reviews.actions.rejectConfirm')
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
