import { requireAdmin } from '@/app/lib/session';
import Link from '@/i18n/link';
import { getAllCategoryContent } from '@/app/services/category-content-service';
import { deleteCategoryContent } from '@/app/actions/admin-categories';
import { RowActionButton } from '@/components/admin/RowActionButton';
import { ContentStatusBadges } from '@/components/admin/ContentStatusBadges';
import { loadContentStatus } from '@/app/services/admin-content-status';
import prisma from '@/app/lib/prisma';
import { getT } from '@/i18n/server';
import { rich } from '@/i18n/rich';

export const dynamic = 'force-dynamic';

export default async function AdminCategoriesPage() {
  await requireAdmin();
  const [contents, serviceCategoriesRaw, t, tc, tContent] = await Promise.all([
    // English: admins manage the source text; translation state is shown per row.
    getAllCategoryContent(),
    prisma.service.groupBy({ by: ['category'], _count: { _all: true } }),
    getT('adminCatalog'),
    getT('common'),
    getT('adminContent'),
  ]);
  const contentStatus = await loadContentStatus('CATEGORY_CONTENT', contents.map((c) => c.id));
  const statusLabels = { chineseMissing: tContent('contentStatus.chineseMissing'), draftPending: tContent('contentStatus.draftPending') };

  const serviceCounts = new Map<string, number>();
  for (const row of serviceCategoriesRaw) {
    serviceCounts.set(row.category, row._count._all);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-start justify-between mb-8 gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">{t('categories.list.title')}</h1>
          <p className="text-zinc-700 mt-2">
            {rich(t('categories.list.intro'), {
              code: (text) => <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-xs">{text}</code>,
            })}
          </p>
        </div>
        <Link
          href="/admin/categories/new"
          className="shrink-0 bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded"
        >
          + {t('categories.list.new')}
        </Link>
      </div>

      {contents.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <p className="text-zinc-500">{t('categories.list.empty')}</p>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-lg overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-200 bg-zinc-50">
              <tr>
                <th className="text-left text-xs uppercase tracking-wider text-zinc-500 font-medium px-6 py-3">
                  {t('categories.list.columns.title')}
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-zinc-500 font-medium px-4 py-3">
                  {t('categories.list.columns.category')}
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-zinc-500 font-medium px-4 py-3 w-32">
                  {t('categories.list.columns.services')}
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-zinc-500 font-medium px-4 py-3 w-24">
                  {t('categories.list.columns.order')}
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-zinc-500 font-medium px-6 py-3 w-44">
                  {t('categories.list.columns.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {contents.map((c) => {
                const hasMatchingServices = (serviceCounts.get(c.category) ?? 0) > 0;
                return (
                  <tr key={c.id} className="hover:bg-zinc-50">
                    <td className="px-6 py-4">
                      <p className="font-medium text-zinc-900">{c.title}</p>
                      <p className="text-xs text-zinc-500 font-mono mt-0.5">/services/{c.slug}</p>
                      <ContentStatusBadges status={contentStatus.get(c.id)} labels={statusLabels} />
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <span
                        title={hasMatchingServices ? undefined : t('categories.list.noServices')}
                        className={`inline-block px-2.5 py-1 text-xs uppercase tracking-wider font-bold rounded-full ${
                          hasMatchingServices
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-zinc-100 text-zinc-700'
                        }`}
                      >
                        {c.category}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right text-sm text-zinc-600">
                      {serviceCounts.get(c.category) ?? 0}
                    </td>
                    <td className="px-4 py-4 text-right text-sm text-zinc-600 font-mono">
                      {c.displayOrder}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/services/${c.slug}`}
                          target="_blank"
                          className="text-xs font-medium text-zinc-600 hover:text-zinc-900 px-3 py-1.5 rounded hover:bg-zinc-100 transition-colors"
                        >
                          {t('categories.list.view')}
                        </Link>
                        <Link
                          href={`/admin/categories/${c.id}/edit`}
                          className="text-xs font-medium text-zinc-900 px-3 py-1.5 rounded hover:bg-zinc-100 transition-colors"
                        >
                          {tc('actions.edit')}
                        </Link>
                        <RowActionButton
                          action={deleteCategoryContent.bind(null, c.id)}
                          label={tc('actions.delete')}
                          pendingLabel={tc('actions.deleting')}
                          buttonClassName="text-xs font-medium px-3 py-1.5 rounded text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors"
                          confirmMessage={t('categories.list.deleteConfirm', { title: c.title })}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
