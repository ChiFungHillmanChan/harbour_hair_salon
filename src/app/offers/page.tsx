import prisma from '@/app/lib/prisma';
import { Offer } from '@prisma/client';
import Link from 'next/link';

// Revalidate data every hour
export const revalidate = 3600;

async function getOffers() {
  const offers = await prisma.offer.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' }
  });
  
  return offers.map(offer => ({
    ...offer,
    discountValue: Number(offer.discountValue)
  }));
}

export default async function OffersPage() {
  const offers = await getOffers();

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="relative py-24 bg-zinc-900 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-40 bg-[url('https://images.unsplash.com/photo-1633681926022-84c23e8cb2d6?q=80&w=2670&auto=format&fit=crop')] bg-cover bg-center" />
        <div className="relative z-10 container mx-auto px-4 text-center">
          <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-tight">
            Exclusive <span className="italic text-zinc-400">Privileges</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed">
            Curated seasonal promotions and tailored experiences designed to elevate your personal style.
          </p>
        </div>
      </section>

      {/* Offers Grid */}
      <section className="container mx-auto px-4 py-24">
        {offers.length === 0 ? (
          <div className="text-center py-20 max-w-2xl mx-auto border border-zinc-100 rounded-sm bg-zinc-50">
            <h3 className="text-2xl font-serif text-zinc-400 mb-2">Quiet Season</h3>
            <p className="text-zinc-500 font-light">
              We are currently curating new experiences. Please check back soon for exclusive offers.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 md:gap-16">
            {offers.map((offer) => (
              <div 
                key={offer.id} 
                className="group relative bg-white border border-zinc-200 p-10 md:p-14 transition-all duration-500 hover:shadow-2xl hover:border-zinc-300 flex flex-col justify-between min-h-[360px]"
              >
                {/* Decorative Accent */}
                <div className="absolute top-0 left-0 w-full h-1 bg-zinc-900 transform origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />
                
                <div>
                  <div className="flex justify-between items-start mb-8">
                    <span className="inline-block px-4 py-1.5 border border-zinc-200 text-xs font-medium tracking-[0.15em] uppercase text-zinc-500">
                      Limited Time
                    </span>
                    <div className="text-right">
                      <span className="block text-4xl md:text-5xl font-serif font-bold text-zinc-900 mb-1">
                        {offer.discountType === 'PERCENTAGE' ? `${offer.discountValue}%` : `£${offer.discountValue}`}
                      </span>
                      <span className="text-xs text-zinc-500 uppercase tracking-widest">Off Service</span>
                    </div>
                  </div>

                  <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 mb-6 group-hover:text-zinc-700 transition-colors tracking-tight">
                    {offer.title}
                  </h2>
                  
                  <div className="w-12 h-px bg-zinc-200 my-8 group-hover:w-24 transition-all duration-500" />
                  
                  <p className="text-zinc-600 font-light leading-relaxed mb-10 text-lg">
                    {offer.description}
                  </p>
                </div>

                <div className="pt-6">
                  <Link 
                    href="/book"
                    className="inline-flex items-center text-sm font-bold uppercase tracking-[0.2em] text-zinc-900 group-hover:text-zinc-600 transition-colors border-b border-transparent group-hover:border-zinc-300 pb-1"
                  >
                    Book Experience
                    <svg className="w-4 h-4 ml-2 transform group-hover:translate-x-2 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Newsletter / VIP Section Placeholder */}
      <section className="bg-zinc-50 py-24 border-t border-zinc-200">
        <div className="container mx-auto px-4 text-center">
          <h3 className="text-3xl font-serif mb-6 text-zinc-900">Join Our Guest List</h3>
          <p className="text-zinc-500 mb-10 max-w-lg mx-auto font-light text-lg">
            Be the first to receive updates on new styles, exclusive events, and seasonal privileges.
          </p>
          <div className="max-w-md mx-auto flex gap-0 shadow-sm">
             <input 
               type="email" 
               placeholder="Email Address" 
               className="flex-1 px-6 py-4 bg-white border border-zinc-200 border-r-0 focus:outline-none focus:border-zinc-900 transition-colors text-sm placeholder:font-light"
             />
             <button className="px-10 py-4 bg-zinc-900 text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-zinc-800 transition-colors">
               Subscribe
             </button>
          </div>
        </div>
      </section>
    </div>
  );
}
