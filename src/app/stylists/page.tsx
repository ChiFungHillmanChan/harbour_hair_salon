import type { Metadata } from 'next';
import { jsonLdScript } from '@/app/lib/json-ld';
import Link from 'next/link';
import { getAllStylistsWithSlug } from './slug';
import { SITE_URL as BASE_URL } from '@/app/lib/site-url';

export const metadata: Metadata = {
  title: 'Meet the Stylists',
  description:
    'Meet the Hong Kong trained stylists at Harbour Hair Salon in Leeds city centre. Our team, their specialties and what to expect at your appointment.',
  alternates: { canonical: '/stylists' },
  openGraph: {
    title: 'Meet the Stylists | Harbour Hair Salon Leeds',
    description:
      'Our Hong Kong trained stylists and what they specialise in, at Harbour Hair Salon, Leeds.',
  },
};

export const revalidate = 3600;

export default async function StylistsIndexPage() {
  const stylists = await getAllStylistsWithSlug();

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: 'Stylists', item: `${BASE_URL}/stylists` },
    ],
  };

  const itemListSchema = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Stylists at Harbour Hair Salon',
    itemListElement: stylists.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Person',
        name: s.name,
        jobTitle: s.role,
        url: `${BASE_URL}/stylists/${s.slug}`,
        image: s.imageUrl || undefined,
        worksFor: {
          '@type': 'HairSalon',
          name: 'Harbour Hair Salon',
          url: BASE_URL,
        },
      },
    })),
  };

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(itemListSchema) }}
      />

      <section className="relative py-24 bg-zinc-900 text-white overflow-hidden">
        <div className="relative z-10 container mx-auto px-4 text-center">
          <nav aria-label="Breadcrumb" className="mb-4 text-xs text-zinc-400 uppercase tracking-[0.2em]">
            <ol className="flex items-center justify-center gap-2">
              <li><Link href="/" className="hover:text-zinc-300">Home</Link></li>
              <li aria-hidden="true">·</li>
              <li className="text-zinc-200">Stylists</li>
            </ol>
          </nav>
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-tight">
            Meet the <span className="text-zinc-400">Team</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed">
            Hong Kong trained stylists in the heart of Leeds city centre, each with their own style and specialty.
          </p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-20 max-w-5xl">
        {stylists.length === 0 ? (
          <p className="text-center text-zinc-500 py-20">Our team will be introduced here soon.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-10">
            {stylists.map((stylist) => {
              return (
                <Link
                  key={stylist.id}
                  href={`/stylists/${stylist.slug}`}
                  className="group block bg-white border border-zinc-200 rounded-2xl overflow-hidden hover:border-zinc-900 hover:shadow-xl transition-all"
                >
                  <div className="relative aspect-[4/5] bg-zinc-100 overflow-hidden">
                    {stylist.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={stylist.imageUrl}
                        alt={`${stylist.name}, ${stylist.role} at Harbour Hair Salon Leeds`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-300">
                        <svg className="w-24 h-24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
                          <circle cx="12" cy="8" r="4" />
                          <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="p-8">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-2">{stylist.role}</p>
                    <h2 className="text-3xl font-serif text-zinc-900 mb-3 group-hover:text-zinc-700 transition-colors">
                      {stylist.name}
                    </h2>
                    {stylist.tagline ? (
                      <p className="text-zinc-600 font-light leading-relaxed mb-4">{stylist.tagline}</p>
                    ) : stylist.bio ? (
                      <p className="text-zinc-600 font-light leading-relaxed mb-4 line-clamp-3">{stylist.bio}</p>
                    ) : null}
                    <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.15em] text-zinc-900 group-hover:text-zinc-600 transition-colors">
                      View profile
                      <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
