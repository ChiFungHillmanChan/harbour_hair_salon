import { requireAdmin } from '@/app/lib/session';
import Link from '@/i18n/link';
import { unstable_rethrow } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { getAllStylistsWithSlug } from '@/app/stylists/slug';
import { deleteStylist } from '@/app/actions/admin-stylists';
import { RowActionButton, type RowActionResult } from '@/components/admin/RowActionButton';
import { ContentStatusBadges } from '@/components/admin/ContentStatusBadges';
import { loadContentStatus } from '@/app/services/admin-content-status';
import { getActionT } from '@/i18n/request';
import { getT } from '@/i18n/server';
import { rich } from '@/i18n/rich';

export const dynamic = 'force-dynamic';

/**
 * deleteStylist reports its admin and appointment guards by throwing, which in
 * production reaches the browser as an opaque digest and replaces the page with
 * an error boundary. Adapt it to the `{ error }` shape RowActionButton renders
 * so the reason lands next to the row. The admin guard still runs first — it is
 * deleteStylist's own first statement, before anything is read or written.
 */
async function deleteStylistRow(id: string): Promise<RowActionResult> {
  'use server';
  const formData = new FormData();
  formData.set('id', id);

  try {
    await deleteStylist(formData);
  } catch (error) {
    unstable_rethrow(error);
    console.error('deleteStylist failed:', error);
    const t = await getActionT('adminContent');
    return { error: error instanceof Error ? error.message : t('stylists.list.deleteFailed') };
  }

  return { success: true };
}

export default async function AdminStylistsPage() {
  await requireAdmin();
  const [stylists, counts, t, tc] = await Promise.all([
    // English: admins manage the source text; translation state is shown per row.
    getAllStylistsWithSlug(),
    prisma.appointment.groupBy({
      by: ['stylistId'],
      _count: { _all: true },
    }),
    getT('adminContent'),
    getT('common'),
  ]);
  const contentStatus = await loadContentStatus('STYLIST', stylists.map((s) => s.id));
  const statusLabels = { chineseMissing: t('contentStatus.chineseMissing'), draftPending: t('contentStatus.draftPending') };

  const appointmentCount = new Map<string, number>();
  for (const row of counts) appointmentCount.set(row.stylistId, row._count._all);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-start justify-between mb-8 gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">{t('stylists.list.title')}</h1>
          <p className="text-zinc-700 mt-2">
            {rich(t('stylists.list.intro'), {
              link: (text) => (
                <Link href="/stylists" className="underline hover:text-zinc-900">
                  {text}
                </Link>
              ),
            })}
          </p>
        </div>
        <Link
          href="/admin/stylists/new"
          className="shrink-0 bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded"
        >
          + {t('stylists.list.new')}
        </Link>
      </div>

      {stylists.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <p className="text-zinc-500 mb-6">{t('stylists.list.empty')}</p>
          <Link
            href="/admin/stylists/new"
            className="inline-block bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded"
          >
            + {t('stylists.list.addFirst')}
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-lg overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-200 bg-zinc-50">
              <tr>
                <th className="text-left text-xs uppercase tracking-wider text-zinc-500 font-medium px-6 py-3">
                  {t('stylists.list.columns.stylist')}
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-zinc-500 font-medium px-4 py-3">
                  {t('stylists.list.columns.role')}
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-zinc-500 font-medium px-4 py-3">
                  {t('stylists.list.columns.slug')}
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-zinc-500 font-medium px-4 py-3 w-28">
                  {t('stylists.list.columns.bookings')}
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-zinc-500 font-medium px-6 py-3 w-40">
                  {t('stylists.list.columns.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {stylists.map((s) => {
                const bookings = appointmentCount.get(s.id) ?? 0;
                return (
                  <tr key={s.id} className="hover:bg-zinc-50">
                    <td className="px-6 py-4">
                      <p className="font-medium text-zinc-900">{s.name}</p>
                      {s.tagline && <p className="text-xs text-zinc-500 italic mt-0.5">{s.tagline}</p>}
                      <ContentStatusBadges status={contentStatus.get(s.id)} labels={statusLabels} />
                    </td>
                    <td className="px-4 py-4 text-sm text-zinc-600">{s.role}</td>
                    <td className="px-4 py-4 text-xs text-zinc-500 font-mono">/{s.slug}</td>
                    <td className="px-4 py-4 text-right text-sm text-zinc-600">{bookings}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/stylists/${s.slug}`}
                          target="_blank"
                          className="text-xs font-medium text-zinc-600 hover:text-zinc-900 px-3 py-1.5 rounded hover:bg-zinc-100 transition-colors"
                        >
                          {t('stylists.list.view')}
                        </Link>
                        <Link
                          href={`/admin/stylists/${s.id}/edit`}
                          className="text-xs font-medium text-zinc-900 px-3 py-1.5 rounded hover:bg-zinc-100 transition-colors"
                        >
                          {tc('actions.edit')}
                        </Link>
                        {bookings === 0 ? (
                          <RowActionButton
                            action={deleteStylistRow.bind(null, s.id)}
                            label={tc('actions.delete')}
                            pendingLabel={tc('actions.deleting')}
                            buttonClassName="text-xs font-medium px-3 py-1.5 rounded text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors"
                            confirmMessage={t('stylists.list.deleteConfirm', { name: s.name })}
                          />
                        ) : (
                          <span className="text-xs text-zinc-400 px-3 py-1.5" title={t('stylists.list.lockedHelp')}>
                            {t('stylists.list.locked')}
                          </span>
                        )}
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
