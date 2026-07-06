import Link from 'next/link';
import { getAllCategoryContent } from '@/app/services/category-content-service';
import { deleteCategoryContent } from '@/app/actions/admin-categories';
import prisma from '@/app/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function AdminCategoriesPage() {
  const [contents, serviceCategoriesRaw] = await Promise.all([
    getAllCategoryContent(),
    prisma.service.groupBy({ by: ['category'], _count: { _all: true } }),
  ]);

  const serviceCounts = new Map<string, number>();
  for (const row of serviceCategoriesRaw) {
    serviceCounts.set(row.category, row._count._all);
  }

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-8 gap-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-zinc-900">Category pages</h1>
          <p className="text-zinc-700 mt-2">
            Long-form SEO content for each service category page at{' '}
            <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-xs">/services/[slug]</code>.
          </p>
        </div>
        <Link
          href="/admin/categories/new"
          className="shrink-0 bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded"
        >
          + New category page
        </Link>
      </div>

      {contents.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <p className="text-zinc-500">No category pages yet.</p>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-zinc-200 bg-zinc-50">
              <tr>
                <th className="text-left text-xs uppercase tracking-wider text-zinc-500 font-medium px-6 py-3">
                  Title
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-zinc-500 font-medium px-4 py-3">
                  Category
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-zinc-500 font-medium px-4 py-3 w-32">
                  Services
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-zinc-500 font-medium px-4 py-3 w-24">
                  Order
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-zinc-500 font-medium px-6 py-3 w-44">
                  Actions
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
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <span
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
                          View
                        </Link>
                        <Link
                          href={`/admin/categories/${c.id}/edit`}
                          className="text-xs font-medium text-zinc-900 px-3 py-1.5 rounded hover:bg-zinc-100 transition-colors"
                        >
                          Edit
                        </Link>
                        <form action={deleteCategoryContent}>
                          <input type="hidden" name="id" value={c.id} />
                          <button
                            type="submit"
                            className="text-xs font-medium px-3 py-1.5 rounded text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors"
                          >
                            Delete
                          </button>
                        </form>
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
