import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import { jsonLdScript } from '@/app/lib/json-ld';
import Link from '@/i18n/link';
import { getAllStylistsWithSlug } from '@/app/stylists/slug';
import { SITE_URL as BASE_URL } from '@/app/lib/site-url';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor, ogLocale } from '@/i18n/metadata';
import { localizeHref } from '@/i18n/paths';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('stylists')]);
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: alternatesFor(locale, '/stylists'),
    openGraph: {
      ...OG_BASE,
      ...ogLocale(locale),
      title: t('meta.ogTitle'),
      description: t('meta.ogDescription'),
    },
  };
}

export const revalidate = 3600;

export default async function StylistsIndexPage() {
  const locale = await getLocale();
  const [stylists, t] = await Promise.all([getAllStylistsWithSlug(locale), getT('stylists')]);
  const url = (path: string) => `${BASE_URL}${localizeHref(locale, path) === '/' ? '' : localizeHref(locale, path)}`;
  // English is shown where a stylist's profile has no published translation.
  const fallbackLang = (translated: boolean) => (locale === 'en-GB' || translated ? undefined : 'en');

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: t('breadcrumb.home'), item: url('/') },
      { '@type': 'ListItem', position: 2, name: t('breadcrumb.stylists'), item: url('/stylists') },
    ],
  };

  const itemListSchema = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: t('index.schemaName'),
    itemListElement: stylists.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Person',
        name: s.name,
        jobTitle: s.role,
        url: url(`/stylists/${s.slug}`),
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
          <nav aria-label={t('breadcrumb.label')} className="mb-4 text-xs text-zinc-400 uppercase tracking-[0.2em]">
            <ol className="flex items-center justify-center gap-2">
              <li><Link href="/" className="hover:text-zinc-300">{t('breadcrumb.home')}</Link></li>
              <li aria-hidden="true">·</li>
              <li className="text-zinc-200">{t('breadcrumb.stylists')}</li>
            </ol>
          </nav>
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-tight">
            {t('index.titleStart')} <span className="text-zinc-400">{t('index.titleEnd')}</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed">
            {t('index.subtitle')}
          </p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-20 max-w-5xl">
        {stylists.length === 0 ? (
          <p className="text-center text-zinc-500 py-20">{t('index.empty')}</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-10">
            {stylists.map((stylist) => {
              const lang = fallbackLang(stylist.translated);
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
                        alt={t('index.portraitAlt', { name: stylist.name, role: stylist.role })}
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
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-2" lang={lang}>{stylist.role}</p>
                    <h2 className="text-3xl font-serif text-zinc-900 mb-3 group-hover:text-zinc-700 transition-colors">
                      {stylist.name}
                    </h2>
                    {stylist.tagline ? (
                      <p className="text-zinc-600 font-light leading-relaxed mb-4" lang={lang}>{stylist.tagline}</p>
                    ) : stylist.bio ? (
                      <p className="text-zinc-600 font-light leading-relaxed mb-4 line-clamp-3" lang={lang}>{stylist.bio}</p>
                    ) : null}
                    <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.15em] text-zinc-900 group-hover:text-zinc-600 transition-colors">
                      {t('index.viewProfile')}
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
