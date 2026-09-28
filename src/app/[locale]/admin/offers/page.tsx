import { requireAdmin } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import Link from '@/i18n/link';
import { OfferForm } from '@/components/admin/OfferForm';
import { OfferInlineEditor } from '@/components/admin/OfferInlineEditor';
import { RowActionButton } from '@/components/admin/RowActionButton';
import { ContentStatusBadges } from '@/components/admin/ContentStatusBadges';
import { loadContentStatus } from '@/app/services/admin-content-status';
import { deleteOffer, toggleOfferStatus, updateOffer, type OfferActionState } from '@/app/actions/admin';
import { DISCOUNTS_PAUSED } from '@/app/services/pricing/policy';
import { getT } from '@/i18n/server';

export const dynamic = 'force-dynamic';

export default async function AdminOffersPage() {
  await requireAdmin();
  const [offers, t, tc] = await Promise.all([
    prisma.offer.findMany({
      orderBy: { createdAt: 'desc' },
    }),
    getT('adminContent'),
    getT('common'),
  ]);
  const contentStatus = await loadContentStatus('OFFER', offers.map((offer) => offer.id));
  const statusLabels = { chineseMissing: t('contentStatus.chineseMissing'), draftPending: t('contentStatus.draftPending') };

  // The public pages and the booking price resolve the site-wide discount with
  // findFirst({ isActive, isGlobal }) ordered by createdAt desc, so exactly ONE
  // global offer is ever applied. Offers are already listed newest first, so
  // that winner is the first match here — every other global offer is dormant,
  // and the badge has to say so rather than implying they all apply. While
  // discounts are paused site-wide not even that one is applied.
  const effectiveGlobalOfferId = offers.find((o) => o.isActive && o.isGlobal)?.id ?? null;

  const updateOfferAction: (
    prev: OfferActionState,
    formData: FormData
  ) => Promise<OfferActionState> = updateOffer;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">{t('offers.title')}</h1>
        <p className="text-zinc-600 mt-2">{t('offers.intro')}</p>
      </div>

      {DISCOUNTS_PAUSED && (
        <div className="mb-8 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900" role="note">
          <p className="font-semibold">{t('promotions.paused.offersTitle')}</p>
          <p className="mt-1">{t('promotions.paused.offersBody')}</p>
        </div>
      )}

      <OfferForm latestOfferId={offers[0]?.id ?? null} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {offers.map((offer) => {
          const offerLite = {
            id: offer.id,
            discountType: offer.discountType,
            discountValue: Number(offer.discountValue),
            isGlobal: offer.isGlobal,
          };

          const isEffectiveGlobal = offer.id === effectiveGlobalOfferId;
          const globalState = isEffectiveGlobal
            ? (DISCOUNTS_PAUSED ? 'paused' : 'inEffect')
            : offer.isActive ? 'superseded' : 'inactive';

          return (
            <div key={offer.id} className="bg-white rounded-lg shadow border border-zinc-200 p-6">
              <div className="flex justify-between items-start mb-4 gap-2">
                {offer.isGlobal && (
                  <span
                    title={t.dynamic(`offers.card.global.${globalState}Help`)}
                    className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full ${
                      globalState === 'inEffect'
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-500 border border-zinc-300'
                    }`}
                  >
                    {t.dynamic(`offers.card.global.${globalState}`)}
                  </span>
                )}
                <span className={`ml-auto px-2 py-1 text-xs font-medium rounded-full ${offer.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {offer.isActive ? t('promotions.active') : t('promotions.inactive')}
                </span>
              </div>

              <div className="mb-4 border-b border-zinc-100 pb-4">
                <p className="font-medium text-zinc-900">{offer.title}</p>
                {offer.description && <p className="mt-1 text-sm text-zinc-600">{offer.description}</p>}
                <ContentStatusBadges status={contentStatus.get(offer.id)} labels={statusLabels} />
                <div className="mt-2">
                  <Link
                    href={`/admin/offers/${offer.id}/edit`}
                    className="text-xs font-medium text-zinc-900 underline hover:text-zinc-700"
                  >
                    {t('offers.card.editText')}
                  </Link>
                </div>
              </div>

              <OfferInlineEditor offer={offerLite} action={updateOfferAction} />

              <div className="flex justify-between items-start pt-4 mt-4 border-t border-zinc-100">
                  <RowActionButton
                    action={toggleOfferStatus.bind(null, offer.id, !offer.isActive)}
                    label={offer.isActive ? t('promotions.deactivate') : t('promotions.activate')}
                    pendingLabel={offer.isActive ? t('promotions.deactivating') : t('promotions.activating')}
                    buttonClassName="text-sm text-zinc-700 hover:text-zinc-900 font-medium"
                  />
                  <RowActionButton
                    action={deleteOffer.bind(null, offer.id)}
                    label={tc('actions.delete')}
                    pendingLabel={tc('actions.deleting')}
                    buttonClassName="text-sm text-red-600 hover:text-red-800 font-medium"
                    confirmMessage={t('offers.card.deleteConfirm')}
                  />
              </div>
            </div>
          );
        })}
        {offers.length === 0 && (
            <div className="col-span-2 text-center text-zinc-500 py-8">{t('offers.empty')}</div>
        )}
      </div>
    </div>
  );
}
