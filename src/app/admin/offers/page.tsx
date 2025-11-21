import prisma from '@/app/lib/prisma';
import { OfferForm } from '@/components/admin/OfferForm';
import { deleteOffer, toggleOfferStatus } from '@/app/actions/admin';

export default async function AdminOffersPage() {
  const offers = await prisma.offer.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">Special Offers</h1>
        <p className="text-zinc-600 mt-2">Manage global offers visible on the Offers page.</p>
      </div>

      <OfferForm />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {offers.map((offer) => (
          <div key={offer.id} className="bg-white rounded-lg shadow border border-zinc-200 p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-bold text-zinc-900">{offer.title}</h3>
                {offer.isGlobal && (
                  <span className="inline-block mt-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-800 rounded-full">
                    Global Discount
                  </span>
                )}
              </div>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${offer.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                {offer.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="text-zinc-600 mb-4 min-h-[48px]">{offer.description}</p>
            <div className="flex items-center gap-2 mb-6 text-sm font-medium text-blue-600">
               {offer.discountType === 'PERCENTAGE' ? `${offer.discountValue}% OFF` : `£${offer.discountValue} OFF`}
            </div>
            
            <div className="flex justify-between items-center pt-4 border-t border-zinc-100">
                <form action={toggleOfferStatus.bind(null, offer.id, !offer.isActive)}>
                    <button className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                        {offer.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                </form>
                <form action={deleteOffer.bind(null, offer.id)}>
                    <button className="text-sm text-red-600 hover:text-red-800 font-medium">Delete</button>
                </form>
            </div>
          </div>
        ))}
        {offers.length === 0 && (
            <div className="col-span-2 text-center text-zinc-500 py-8">No offers created yet.</div>
        )}
      </div>
    </div>
  );
}
