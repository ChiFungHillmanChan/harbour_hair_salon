import { requireAdmin } from '@/app/lib/session';
import Link from '@/i18n/link';
import { getAllPostsForAdmin } from '@/app/services/blog-service';
import { deleteBlogPost, toggleBlogPostStatus } from '@/app/actions/admin-blog';
import { RowActionButton } from '@/components/admin/RowActionButton';
import { ContentStatusBadges } from '@/components/admin/ContentStatusBadges';
import { Pagination } from '@/components/admin/Pagination';
import { loadContentStatus } from '@/app/services/admin-content-status';
import { pageNumber } from '@/app/lib/pagination';
import { formatSalonMediumDate } from '@/i18n/dates';
import { getLocale, getT } from '@/i18n/server';
import { rich } from '@/i18n/rich';

export const dynamic = 'force-dynamic';

export default async function AdminBlogListPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  await requireAdmin();
  const page = pageNumber((await searchParams).page);
  const [{ posts, hasMore, total, publishedCount, draftCount }, locale, t, tc] = await Promise.all([
    getAllPostsForAdmin(page),
    getLocale(),
    getT('adminContent'),
    getT('common'),
  ]);
  const contentStatus = await loadContentStatus('BLOG_POST', posts.map((post) => post.id));
  const statusLabels = { chineseMissing: t('contentStatus.chineseMissing'), draftPending: t('contentStatus.draftPending') };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-start justify-between mb-8 gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">{t('blog.list.title')}</h1>
          <p className="text-zinc-700 mt-2">
            {rich(t('blog.list.intro'), {
              link: (text) => (
                <Link href="/blog" className="underline hover:text-zinc-900">
                  {text}
                </Link>
              ),
            })}
          </p>
        </div>
        <Link
          href="/admin/blog/new"
          className="shrink-0 bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded"
        >
          + {t('blog.list.new')}
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">{t('blog.list.stats.total')}</p>
          <p className="text-3xl font-bold text-zinc-900 mt-1">{total}</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">{t('blog.list.stats.published')}</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">{publishedCount}</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">{t('blog.list.stats.drafts')}</p>
          <p className="text-3xl font-bold text-zinc-900 mt-1">{draftCount}</p>
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <p className="text-zinc-500 mb-6">{page > 1 ? t('blog.list.emptyPage') : t('blog.list.empty')}</p>
          <Link
            href="/admin/blog/new"
            className="inline-block bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded"
          >
            + {t('blog.list.new')}
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-lg overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50">
                <th className="text-left text-xs uppercase tracking-wider text-zinc-500 font-medium px-6 py-3 whitespace-nowrap">
                  {t('blog.list.columns.title')}
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-zinc-500 font-medium px-4 py-3 whitespace-nowrap">
                  {t('blog.list.columns.status')}
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-zinc-500 font-medium px-4 py-3 whitespace-nowrap">
                  {t('blog.list.columns.published')}
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-zinc-500 font-medium px-6 py-3 whitespace-nowrap">
                  {t('blog.list.columns.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {posts.map((post) => (
                <tr key={post.id} className="hover:bg-zinc-50">
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium text-zinc-900">{post.title}</p>
                      <p className="text-xs text-zinc-500 mt-0.5 font-mono">/{post.slug}</p>
                      <ContentStatusBadges status={contentStatus.get(post.id)} labels={statusLabels} />
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span
                      className={`inline-block px-2.5 py-1 text-xs uppercase tracking-wider font-bold rounded-full ${
                        post.status === 'PUBLISHED'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-zinc-100 text-zinc-700'
                      }`}
                    >
                      {t.dynamic(`blog.list.status.${post.status}`, undefined, post.status)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-sm text-zinc-600 whitespace-nowrap">
                    {formatSalonMediumDate(locale, post.publishedAt)}
                  </td>
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      {post.status === 'PUBLISHED' && (
                        <Link
                          href={`/blog/${post.slug}`}
                          target="_blank"
                          className="text-xs font-medium text-zinc-600 hover:text-zinc-900 px-3 py-1.5 rounded hover:bg-zinc-100 transition-colors"
                        >
                          {t('blog.list.view')}
                        </Link>
                      )}
                      <Link
                        href={`/admin/blog/${post.id}/edit`}
                        className="text-xs font-medium text-zinc-900 px-3 py-1.5 rounded hover:bg-zinc-100 transition-colors"
                      >
                        {tc('actions.edit')}
                      </Link>
                      <RowActionButton
                        action={toggleBlogPostStatus.bind(
                          null,
                          post.id,
                          post.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED'
                        )}
                        label={post.status === 'PUBLISHED' ? t('blog.list.unpublish') : t('blog.list.publish')}
                        pendingLabel={post.status === 'PUBLISHED' ? t('blog.list.unpublishing') : t('blog.list.publishing')}
                        buttonClassName="text-xs font-medium px-3 py-1.5 rounded transition-colors text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
                      />
                      <RowActionButton
                        action={deleteBlogPost.bind(null, post.id)}
                        label={tc('actions.delete')}
                        pendingLabel={tc('actions.deleting')}
                        buttonClassName="text-xs font-medium px-3 py-1.5 rounded transition-colors text-red-600 hover:text-red-700 hover:bg-red-50"
                        confirmMessage={t('blog.list.deleteConfirm', { title: post.title })}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination path="/admin/blog" page={page} hasMore={hasMore} />
    </div>
  );
}
