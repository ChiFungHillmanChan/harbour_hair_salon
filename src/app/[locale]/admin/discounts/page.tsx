import { requireAdmin } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import { AdminResponsiveTable } from '@/components/admin/AdminResponsiveTable';
import { DiscountForm } from '@/components/admin/DiscountForm';
import { RowActionButton } from '@/components/admin/RowActionButton';
import { deleteDiscountCode, toggleDiscountCodeStatus } from '@/app/actions/admin';
import { DISCOUNTS_PAUSED } from '@/app/services/pricing/policy';
import { formatGBP, toPence } from '@/app/services/pricing/money';
import { HTML_LANG } from '@/i18n/config';
import { formatSalonMediumDate } from '@/i18n/dates';
import { getLocale, getT } from '@/i18n/server';

export default async function DiscountsPage() {
  await requireAdmin();
  const [discounts, locale, t, tc] = await Promise.all([
    prisma.discountCode.findMany({
      orderBy: { createdAt: 'desc' },
    }),
    getLocale(),
    getT('adminContent'),
    getT('common'),
  ]);

  return (
    <div className="p-3 sm:p-6 lg:p-8">
      <div className="mb-4 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">{t('discounts.title')}</h1>
        <p className="text-sm text-zinc-600 mt-1 sm:mt-2 sm:text-base">{t('discounts.intro')}</p>
      </div>

      {DISCOUNTS_PAUSED && (
        <details className="mb-3 sm:mb-6 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900">
          <summary className="min-h-11 cursor-pointer px-3 py-3 font-semibold">{t('promotions.paused.codesTitle')}</summary>
          <p className="px-3 pb-3 leading-6">{t('promotions.paused.codesBody')}</p>
        </details>
      )}

      <DiscountForm />

      <div className="bg-white rounded-lg shadow border border-zinc-200 overflow-hidden md:overflow-x-auto">
        <AdminResponsiveTable className="divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('discounts.columns.code')}</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('discounts.columns.type')}</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('discounts.columns.value')}</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('discounts.columns.uses')}</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('discounts.columns.expires')}</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('discounts.columns.actions')}</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-zinc-200">
            {discounts.map((discount) => (
              <tr key={discount.id}>
                <td data-label={t('discounts.columns.code')} data-primary className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900">
                  {discount.code}
                  {!discount.isActive && (
                    <span className="ml-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-zinc-100 text-zinc-500 rounded-full">
                      {t('promotions.inactive')}
                    </span>
                  )}
                </td>
                <td data-label={t('discounts.columns.type')} className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                  {t.dynamic(`discounts.typeLabels.${discount.type}`, undefined, discount.type)}
                </td>
                <td data-label={t('discounts.columns.value')} className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                  {discount.type === 'PERCENTAGE' ? `${discount.value}%` : formatGBP(toPence(discount.value), HTML_LANG[locale])}
                </td>
                <td data-label={t('discounts.columns.uses')} className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                  {discount.usedCount} / {discount.maxUses || '∞'}
                </td>
                <td data-label={t('discounts.columns.expires')} className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                  {discount.expiresAt ? formatSalonMediumDate(locale, discount.expiresAt) : t('discounts.never')}
                </td>
                <td data-label={t('discounts.columns.actions')} data-actions className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex flex-wrap items-start justify-start gap-3 sm:justify-end sm:gap-4">
                    <RowActionButton
                      action={toggleDiscountCodeStatus.bind(null, discount.id, !discount.isActive)}
                      label={discount.isActive ? t('promotions.deactivate') : t('promotions.activate')}
                      pendingLabel={discount.isActive ? t('promotions.deactivating') : t('promotions.activating')}
                      buttonClassName="min-h-11 px-3 py-2 text-zinc-600 hover:text-zinc-900"
                    />
                    {/* A redeemed code can only ever be deactivated — the server
                        turns its delete into a deactivation to keep the
                        appointment's foreign key intact. */}
                    {discount.usedCount === 0 && (
                      <RowActionButton
                        action={deleteDiscountCode.bind(null, discount.id)}
                        label={tc('actions.delete')}
                        pendingLabel={tc('actions.deleting')}
                        buttonClassName="min-h-11 px-3 py-2 text-red-600 hover:text-red-900"
                        confirmMessage={t('discounts.deleteConfirm', { code: discount.code })}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {discounts.length === 0 && (
                <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-sm text-zinc-500">{t('discounts.empty')}</td>
                </tr>
            )}
          </tbody>
        </AdminResponsiveTable>
      </div>
    </div>
  );
}
