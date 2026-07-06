import type { Metadata } from 'next';
import Image from 'next/image';
import prisma from '@/app/lib/prisma';
import Link from 'next/link';
import { NewsletterForm } from '@/components/newsletter/NewsletterForm';
import { SITE_URL } from '@/app/lib/site-url';

export const metadata: Metadata = {
  title: 'Special Offers & Promotions in Leeds',
  description: 'Exclusive seasonal promotions and special offers at Harbour Hair Salon, Leeds city centre. Save on haircuts, colours and treatments.',
  alternates: { canonical: '/offers' },
  openGraph: {
    title: 'Special Offers | Harbour Hair Salon Leeds',
    description: 'Exclusive seasonal promotions. Save on haircuts, colours and treatments at our Leeds city centre salon.',
  },
};

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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
              { '@type': 'ListItem', position: 2, name: 'Special Offers', item: `${SITE_URL}/offers` },
            ],
          }),
        }}
      />
      {/* Hero Section */}
      <section className="relative py-24 bg-zinc-900 text-white overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/images/offers-hero.webp"
            alt="Special offers at Harbour Hair Salon Leeds"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-40"
          />
        </div>
        <div className="relative z-10 container mx-auto px-4 text-center">
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-tight">
            Special <span className="text-zinc-400">Offers</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed">
            Exclusive seasonal promotions at our Leeds city centre salon, designed to elevate your personal style.
          </p>
        </div>
      </section>

      {/* Offers Grid */}
      <section className="container mx-auto px-4 py-24">
        {offers.length === 0 ? (
          <div className="text-center py-20 max-w-2xl mx-auto border border-zinc-100 rounded-sm bg-zinc-50 mb-16">
            <h3 className="text-2xl font-serif text-zinc-400 mb-2">Quiet Season</h3>
            <p className="text-zinc-500 font-light mb-6">
              We are currently curating new experiences. Be the first to know when new offers drop by joining the list below.
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

      {/* Newsletter capture */}
      <section className="container mx-auto px-4 pb-24 max-w-3xl">
        <NewsletterForm
          variant="card"
          source="offers-page"
          title="Never miss an offer"
          description="Join our list to hear about seasonal promotions, new services and early-access bookings before they go public."
        />
      </section>
    </div>
  );
}
