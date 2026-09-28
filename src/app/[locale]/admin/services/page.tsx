import { requireAdmin } from '@/app/lib/session';
import Link from '@/i18n/link';
import { unstable_rethrow } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { deleteService } from '@/app/actions/admin-services';
import { RowActionButton, type RowActionResult } from '@/components/admin/RowActionButton';
import { ContentStatusBadges } from '@/components/admin/ContentStatusBadges';
import { loadContentStatus } from '@/app/services/admin-content-status';
import { formatGBP, toPence } from '@/app/services/pricing/money';
import { HAIR_LENGTH_ORDER, isHairLength } from '@/app/services/pricing/policy';
import { HTML_LANG } from '@/i18n/config';
import { getActionT } from '@/i18n/request';
import { getLocale, getT } from '@/i18n/server';
import { rich } from '@/i18n/rich';

export const dynamic = 'force-dynamic';

/**
 * deleteService reports its admin and appointment guards by throwing, which in
 * production reaches the browser as an opaque digest and replaces the page with
 * an error boundary. Adapt it to the `{ error }` shape RowActionButton renders
 * so the reason lands next to the row. The admin guard still runs first — it is
 * deleteService's own first statement, before anything is read or written.
 */
async function deleteServiceRow(id: string): Promise<RowActionResult> {
  'use server';
  const formData = new FormData();
  formData.set('id', id);

  try {
    await deleteService(formData);
  } catch (error) {
    unstable_rethrow(error);
    console.error('deleteService failed:', error);
    const t = await getActionT('adminCatalog');
    return { error: error instanceof Error ? error.message : t('servicesList.deleteFailed') };
  }

  return { success: true };
}

async function getServicesGrouped() {
  const services = await prisma.service.findMany({
    orderBy: [{ category: 'asc' }, { price: 'asc' }],
    include: {
      _count: { select: { appointments: true } },
      offering: { select: { name: true, displayOrder: true } },
    },
  });

  // Within a category, keep each menu item's options together (short → extra
  // long, standard before NHS) so a standard/NHS pair reads side by side.
  // Standalone services follow, cheapest first as before. Retired options
  // (hidden / not bookable) stay listed with badges — nothing is dropped.
  type Row = (typeof services)[number];
  const menuOrder = (s: Row) => (s.offering ? s.offering.displayOrder : Number.MAX_SAFE_INTEGER);
  const lengthOrder = (s: Row) => (s.hairLength && isHairLength(s.hairLength) ? HAIR_LENGTH_ORDER[s.hairLength] : -1);
  const compare = (a: Row, b: Row) =>
    menuOrder(a) - menuOrder(b)
    || (a.offering?.name ?? '').localeCompare(b.offering?.name ?? '')
    || lengthOrder(a) - lengthOrder(b)
    || Number(a.priceType === 'NHS') - Number(b.priceType === 'NHS')
    || toPence(a.price) - toPence(b.price);

  const grouped = new Map<string, typeof services>();
  for (const s of services) {
    const bucket = grouped.get(s.category) ?? [];
    bucket.push(s);
    grouped.set(s.category, bucket);
  }
  for (const bucket of grouped.values()) bucket.sort(compare);

  return { services, grouped };
}

const badge = 'inline-block px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-full border';

export default async function AdminServicesPage() {
  await requireAdmin();
  const [{ services, grouped }, locale, t, tp, tc, tContent] = await Promise.all([
    getServicesGrouped(),
    getLocale(),
    getT('adminCatalog'),
    getT('pricing'),
    getT('common'),
    getT('adminContent'),
  ]);
  const contentStatus = await loadContentStatus('SERVICE', services.map((s) => s.id));
  const statusLabels = { chineseMissing: tContent('contentStatus.chineseMissing'), draftPending: tContent('contentStatus.draftPending') };
  const money = (pence: number) => formatGBP(pence, HTML_LANG[locale]);
  const averagePence = services.length > 0
    ? Math.round(services.reduce((sum, s) => sum + toPence(s.price), 0) / services.length)
    : 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-start justify-between mb-8 gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">{t('servicesList.title')}</h1>
          <p className="text-zinc-700 mt-2">
            {rich(t('servicesList.intro'), {
              link: (text) => (
                <Link href="/services" className="underline hover:text-zinc-900">
                  {text}
                </Link>
              ),
            })}
          </p>
        </div>
        <Link
          href="/admin/services/new"
          className="shrink-0 bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded"
        >
          + {t('servicesList.newService')}
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">{t('servicesList.stats.total')}</p>
          <p className="text-3xl font-bold text-zinc-900 mt-1">{services.length}</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">{t('servicesList.stats.categories')}</p>
          <p className="text-3xl font-bold text-zinc-900 mt-1">{grouped.size}</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">{t('servicesList.stats.avgPrice')}</p>
          <p className="text-3xl font-bold text-zinc-900 mt-1">{money(averagePence)}</p>
        </div>
      </div>

      {services.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <p className="text-zinc-500 mb-6">{t('servicesList.empty')}</p>
          <Link
            href="/admin/services/new"
            className="inline-block bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded"
          >
            + {t('servicesList.newService')}
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([category, items]) => (
            <div key={category} className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
              <div className="bg-zinc-50 border-b border-zinc-200 px-6 py-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-700">
                  {tp.dynamic(`categories.${category}`, undefined, category)}
                </h2>
                <span className="text-xs text-zinc-500">{t('servicesList.count', { count: items.length })}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-zinc-100">
                    <tr>
                      <th className="text-left text-[11px] uppercase tracking-wider text-zinc-500 font-medium px-6 py-2">
                        {t('servicesList.columns.name')}
                      </th>
                      <th className="text-left text-[11px] uppercase tracking-wider text-zinc-500 font-medium px-4 py-2">
                        {t('servicesList.columns.option')}
                      </th>
                      <th className="text-right text-[11px] uppercase tracking-wider text-zinc-500 font-medium px-4 py-2 w-32">
                        {t('servicesList.columns.price')}
                      </th>
                      <th className="text-right text-[11px] uppercase tracking-wider text-zinc-500 font-medium px-4 py-2 w-28">
                        {t('servicesList.columns.duration')}
                      </th>
                      <th className="text-right text-[11px] uppercase tracking-wider text-zinc-500 font-medium px-4 py-2 w-24">
                        {t('servicesList.columns.bookings')}
                      </th>
                      <th className="text-left text-[11px] uppercase tracking-wider text-zinc-500 font-medium px-4 py-2 w-40">
                        {t('servicesList.columns.status')}
                      </th>
                      <th className="text-right text-[11px] uppercase tracking-wider text-zinc-500 font-medium px-6 py-2 w-40">
                        {t('servicesList.columns.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {items.map((service) => {
                      const bookings = service._count.appointments;
                      const bookable = service.isBookable && service.durationConfirmed;
                      return (
                        <tr key={service.id} className={`hover:bg-zinc-50 ${service.isPublic ? '' : 'bg-zinc-50/60'}`}>
                          <td className="px-6 py-3">
                            <div>
                              <p className="font-medium text-zinc-900 text-sm">{service.name}</p>
                              {service.description && (
                                <p className="text-xs text-zinc-500 mt-0.5">{service.description}</p>
                              )}
                              <ContentStatusBadges status={contentStatus.get(service.id)} labels={statusLabels} />
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-zinc-600">
                            <p className="text-zinc-800">{service.offering?.name ?? t('servicesList.standalone')}</p>
                            <p className="mt-0.5">
                              {[
                                service.hairLength && isHairLength(service.hairLength) ? tp.dynamic(`hairLength.${service.hairLength}`) : null,
                                tp.dynamic(`priceType.${service.priceType}`, undefined, service.priceType),
                              ].filter(Boolean).join(' · ')}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <p className="font-mono font-bold text-zinc-900">{money(toPence(service.price))}</p>
                            {service.vatDisplay === 'EXCLUDED' && (
                              <p className="text-[11px] text-zinc-500 mt-0.5">{tp('vatExcluded')}</p>
                            )}
                            {service.priceNature === 'SUBJECT_TO_CONSULTATION' && (
                              <p className="text-[11px] text-zinc-500 mt-0.5">{tp('subjectToConsultation')}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-zinc-600">
                            {tp('minutes', { count: service.duration })}
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-zinc-600">
                            {bookings}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              <span className={`${badge} ${service.isPublic ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-zinc-100 text-zinc-600 border-zinc-300'}`}>
                                {service.isPublic ? t('servicesList.badges.listed') : t('servicesList.badges.hidden')}
                              </span>
                              <span className={`${badge} ${bookable ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-zinc-100 text-zinc-600 border-zinc-300'}`}>
                                {bookable ? t('servicesList.badges.bookable') : t('servicesList.badges.notBookable')}
                              </span>
                              {!service.durationConfirmed && (
                                <span className={`${badge} bg-amber-50 text-amber-800 border-amber-200`}>
                                  {t('servicesList.badges.durationUnconfirmed')}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Link
                                href={`/admin/services/${service.id}/edit`}
                                className="text-xs font-medium text-zinc-900 px-3 py-1.5 rounded hover:bg-zinc-100 transition-colors"
                              >
                                {tc('actions.edit')}
                              </Link>
                              {bookings === 0 ? (
                                <RowActionButton
                                  action={deleteServiceRow.bind(null, service.id)}
                                  label={tc('actions.delete')}
                                  pendingLabel={tc('actions.deleting')}
                                  buttonClassName="text-xs font-medium px-3 py-1.5 rounded text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors"
                                  confirmMessage={t('servicesList.deleteConfirm', { name: service.name })}
                                />
                              ) : (
                                <span
                                  className="text-xs text-zinc-400 px-3 py-1.5"
                                  title={t('servicesList.lockedHelp')}
                                >
                                  {t('servicesList.locked')}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
