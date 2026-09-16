import { requireAdmin } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import { OfferForm } from '@/components/admin/OfferForm';
import { OfferInlineEditor } from '@/components/admin/OfferInlineEditor';
import { RowActionButton } from '@/components/admin/RowActionButton';
import { deleteOffer, toggleOfferStatus, updateOffer, type OfferActionState } from '@/app/actions/admin';

export const dynamic = 'force-dynamic';

export default async function AdminOffersPage() {
  await requireAdmin();
  const offers = await prisma.offer.findMany({
    orderBy: { createdAt: 'desc' },
  });

  // The public pages and the booking price resolve the site-wide discount with
  // findFirst({ isActive, isGlobal }) ordered by createdAt desc, so exactly ONE
  // global offer is ever applied. Offers are already listed newest first, so
  // that winner is the first match here — every other global offer is dormant,
  // and the badge has to say so rather than implying they all apply.
  const effectiveGlobalOfferId = offers.find((o) => o.isActive && o.isGlobal)?.id ?? null;

  const updateOfferAction: (
    prev: OfferActionState,
    formData: FormData
  ) => Promise<OfferActionState> = updateOffer;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">Special Offers</h1>
        <p className="text-zinc-600 mt-2">Manage global offers visible on the Offers page.</p>
      </div>

      <OfferForm />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {offers.map((offer) => {
          const offerLite = {
            id: offer.id,
            title: offer.title,
            description: offer.description,
            discountType: offer.discountType,
            discountValue: Number(offer.discountValue),
            isGlobal: offer.isGlobal,
          };

          const isEffectiveGlobal = offer.id === effectiveGlobalOfferId;

          return (
            <div key={offer.id} className="bg-white rounded-lg shadow border border-zinc-200 p-6">
              <div className="flex justify-between items-start mb-4">
                {offer.isGlobal && (
                  <span
                    title={
                      isEffectiveGlobal
                        ? 'This is the site-wide discount currently applied to service prices.'
                        : offer.isActive
                          ? 'A newer active global offer is applied instead — only the most recent one takes effect.'
                          : 'Inactive, so it is not applied to service prices.'
                    }
                    className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full ${
                      isEffectiveGlobal
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-500 border border-zinc-300'
                    }`}
                  >
                    {isEffectiveGlobal
                      ? 'Global — in effect'
                      : offer.isActive
                        ? 'Global — superseded'
                        : 'Global — not in effect'}
                  </span>
                )}
                <span className={`ml-auto px-2 py-1 text-xs font-medium rounded-full ${offer.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {offer.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>

              <OfferInlineEditor offer={offerLite} action={updateOfferAction} />

              <div className="flex justify-between items-start pt-4 mt-4 border-t border-zinc-100">
                  <RowActionButton
                    action={toggleOfferStatus.bind(null, offer.id, !offer.isActive)}
                    label={offer.isActive ? 'Deactivate' : 'Activate'}
                    pendingLabel={offer.isActive ? 'Deactivating…' : 'Activating…'}
                    buttonClassName="text-sm text-zinc-700 hover:text-zinc-900 font-medium"
                  />
                  <RowActionButton
                    action={deleteOffer.bind(null, offer.id)}
                    label="Delete"
                    pendingLabel="Deleting…"
                    buttonClassName="text-sm text-red-600 hover:text-red-800 font-medium"
                    confirmMessage="Delete this offer?"
                  />
              </div>
            </div>
          );
        })}
        {offers.length === 0 && (
            <div className="col-span-2 text-center text-zinc-500 py-8">No offers created yet.</div>
        )}
      </div>
    </div>
  );
}
