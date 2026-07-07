import prisma from '@/app/lib/prisma';
import { OfferForm } from '@/components/admin/OfferForm';
import { OfferInlineEditor } from '@/components/admin/OfferInlineEditor';
import { RowActionButton } from '@/components/admin/RowActionButton';
import { deleteOffer, toggleOfferStatus, updateOffer, type OfferActionState } from '@/app/actions/admin';

export const dynamic = 'force-dynamic';

export default async function AdminOffersPage() {
  const offers = await prisma.offer.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const updateOfferAction: (
    prev: OfferActionState,
    formData: FormData
  ) => Promise<OfferActionState> = updateOffer;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">Special Offers</h1>
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

          return (
            <div key={offer.id} className="bg-white rounded-lg shadow border border-zinc-200 p-6">
              <div className="flex justify-between items-start mb-4">
                {offer.isGlobal && (
                  <span className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-zinc-900 text-white rounded-full">
                    Global Discount
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
