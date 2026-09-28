import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import { jsonLdScript } from '@/app/lib/json-ld';
import Link from '@/i18n/link';
import { notFound } from 'next/navigation';
import { getStylistSlugs, getRelatedStylists, getStylistBySlug } from '@/app/stylists/slug';
import { SITE_URL as BASE_URL } from '@/app/lib/site-url';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor, ogLocale } from '@/i18n/metadata';
import { localizeHref } from '@/i18n/paths';
import type { Translate } from '@/i18n/translator';
import type { Messages } from '@/i18n/messages';

export const revalidate = 3600;

export async function generateStaticParams() {
  return getStylistSlugs();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const [stylist, t] = await Promise.all([getStylistBySlug(slug, locale), getT('stylists')]);
  if (!stylist) return {};

  const description =
    stylist.extendedBio[0] ||
    stylist.bio ||
    t('detail.metaDescriptionFallback', { name: stylist.name, role: stylist.role });

  return {
    title: t('detail.metaTitle', { name: stylist.name, role: stylist.role }),
    description: description.slice(0, 158),
    alternates: alternatesFor(locale, `/stylists/${slug}`),
    openGraph: {
      ...OG_BASE,
      ...ogLocale(locale),
      title: t('detail.ogTitle', { name: stylist.name, role: stylist.role }),
      description: description.slice(0, 158),
      type: 'profile',
      // Their own portrait when there is one, otherwise the salon card —
      // never `undefined`, which would erase the OG_BASE fallback above.
      ...(stylist.imageUrl ? { images: [stylist.imageUrl] } : {}),
    },
  };
}

type DefaultSpecialty = keyof Messages['stylists']['defaultSpecialties'];

const DEFAULT_SPECIALTIES_BY_ROLE: Record<'colour' | 'barber' | 'general', DefaultSpecialty[]> = {
  colour: ['colouring', 'balayage', 'colourCorrection', 'toning'],
  barber: ['mensCuts', 'beard', 'barbering', 'childrensCuts'],
  general: ['precisionCuts', 'blowDries', 'consultation'],
};

// The role may be shown in Chinese, so both languages' words count.
function resolveSpecialties(role: string, specialties: string[], t: Translate<Messages['stylists']>): string[] {
  if (specialties.length > 0) return specialties;
  const lower = role.toLowerCase();
  const group = lower.includes('colour') || lower.includes('color') || role.includes('染')
    ? 'colour'
    : lower.includes('barber') || role.includes('理髮')
      ? 'barber'
      : 'general';
  return DEFAULT_SPECIALTIES_BY_ROLE[group].map((key) => t(`defaultSpecialties.${key}`));
}

export default async function StylistDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const [stylist, t] = await Promise.all([getStylistBySlug(slug, locale), getT('stylists')]);
  if (!stylist) notFound();

  const specialties = resolveSpecialties(stylist.role, stylist.specialties, t);
  const languages = stylist.languages.length > 0 ? stylist.languages : [t('detail.defaultLanguage')];
  const bioParagraphs =
    stylist.extendedBio.length > 0 ? stylist.extendedBio : stylist.bio ? [stylist.bio] : [];
  const profile = {
    tagline: stylist.tagline,
    yearsExperience: stylist.yearsExperience,
    trainedIn: stylist.trainedIn,
  };

  const related = await getRelatedStylists(stylist.id, locale);
  const url = (path: string) => `${BASE_URL}${localizeHref(locale, path) === '/' ? '' : localizeHref(locale, path)}`;
  // English is shown where a profile has no published translation.
  const fallbackLang = (translated: boolean) => (locale === 'en-GB' || translated ? undefined : 'en');
  const lang = fallbackLang(stylist.translated);

  const personSchema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: stylist.name,
    jobTitle: stylist.role,
    url: url(`/stylists/${slug}`),
    description: bioParagraphs[0] || t('detail.schemaDescriptionFallback', { role: stylist.role }),
    knowsLanguage: languages,
    knowsAbout: specialties,
    worksFor: {
      '@type': 'HairSalon',
      name: 'Harbour Hair Salon',
      url: BASE_URL,
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Upper Floor, Unit 15 Central Arcade, Central Rd',
        addressLocality: 'Leeds',
        addressRegion: 'West Yorkshire',
        postalCode: 'LS1 6DX',
        addressCountry: 'GB',
      },
    },
  };

  if (stylist.imageUrl) personSchema.image = stylist.imageUrl;
  if (profile.trainedIn)
    personSchema.homeLocation = { '@type': 'Place', name: profile.trainedIn };

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: t('breadcrumb.home'), item: url('/') },
      { '@type': 'ListItem', position: 2, name: t('breadcrumb.stylists'), item: url('/stylists') },
      { '@type': 'ListItem', position: 3, name: stylist.name, item: url(`/stylists/${slug}`) },
    ],
  };

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(personSchema) }}
      />

      {/* Hero */}
      <section className="relative bg-zinc-900 text-white">
        <div className="container mx-auto px-4 py-20 md:py-28">
          <nav aria-label={t('breadcrumb.label')} className="mb-8 text-xs text-zinc-400 uppercase tracking-[0.2em]">
            <ol className="flex items-center gap-2">
              <li><Link href="/" className="hover:text-zinc-300">{t('breadcrumb.home')}</Link></li>
              <li aria-hidden="true">·</li>
              <li><Link href="/stylists" className="hover:text-zinc-300">{t('breadcrumb.stylists')}</Link></li>
              <li aria-hidden="true">·</li>
              <li className="text-zinc-200">{stylist.name}</li>
            </ol>
          </nav>

          <div className="grid md:grid-cols-5 gap-10 items-start">
            <div className="md:col-span-2">
              <div className="relative aspect-[4/5] bg-zinc-800 rounded-2xl overflow-hidden">
                {stylist.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={stylist.imageUrl}
                    alt={t('detail.portraitAlt', { name: stylist.name, role: stylist.role })}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-700">
                    <svg className="w-32 h-32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                    </svg>
                  </div>
                )}
              </div>
            </div>

            <div className="md:col-span-3">
              <div className="w-12 h-[2px] bg-white/50 mb-6" />
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-300 mb-3" lang={lang}>{stylist.role}</p>
              <h1 className="text-5xl md:text-6xl font-serif tracking-tight mb-6">{stylist.name}</h1>
              {profile.tagline && (
                <p className="text-xl md:text-2xl font-serif italic text-zinc-300 leading-relaxed mb-8" lang={lang}>
                  {profile.tagline}
                </p>
              )}

              <div className="grid grid-cols-2 gap-6 mb-10">
                {/* `!!` matters: `yearsExperience` is 0 for stylists whose
                    experience has not been filled in, and `0 && …` evaluates to
                    0, which React renders as a literal "0" on the page. */}
                {!!profile.yearsExperience && (
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 mb-1">{t('detail.experience')}</p>
                    <p className="text-2xl font-serif">{t('detail.years', { count: profile.yearsExperience })}</p>
                  </div>
                )}
                {profile.trainedIn && (
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 mb-1">{t('detail.trainedIn')}</p>
                    <p className="text-2xl font-serif" lang={lang}>{profile.trainedIn}</p>
                  </div>
                )}
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 mb-1">{t('detail.languages')}</p>
                  <p className="text-base text-zinc-300" lang={stylist.languages.length > 0 ? lang : undefined}>{languages.join(t('detail.listSeparator'))}</p>
                </div>
              </div>

              <Link
                href="/book"
                className="inline-block bg-white text-zinc-900 px-10 py-4 text-sm uppercase tracking-[0.15em] font-bold hover:bg-zinc-200 transition-all"
              >
                {t('detail.bookWith', { name: stylist.name })}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      {bioParagraphs.length > 0 && (
        <section className="container mx-auto px-4 py-20 max-w-3xl">
          <div className="w-12 h-[2px] bg-zinc-300 mb-6" />
          <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 tracking-tight mb-8">
            {t('detail.about', { name: stylist.name })}
          </h2>
          <div className="space-y-6 text-zinc-700 font-light leading-relaxed text-lg" lang={lang}>
            {bioParagraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>
      )}

      {/* Specialties */}
      <section className="bg-zinc-50 border-y border-zinc-100 py-20">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="text-center mb-12">
            <div className="w-12 h-[2px] bg-zinc-300 mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 tracking-tight">
              {t('detail.specialties')}
            </h2>
          </div>
          <ul className="grid sm:grid-cols-2 gap-4" lang={stylist.specialties.length > 0 ? lang : undefined}>
            {specialties.map((s, i) => (
              <li
                key={i}
                className="flex items-start gap-3 bg-white p-5 rounded-lg border border-zinc-100"
              >
                <span className="mt-0.5 w-5 h-5 rounded-full bg-zinc-900/10 flex items-center justify-center shrink-0">
                  <svg className="w-3 h-3 text-zinc-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <span className="text-zinc-700 font-light leading-relaxed">{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Related stylists */}
      {related.length > 0 && (
        <section className="container mx-auto px-4 py-20 max-w-5xl">
          <div className="text-center mb-12">
            <div className="w-12 h-[2px] bg-zinc-300 mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 tracking-tight">
              {t('detail.related')}
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {related.map((s) => (
              <Link
                key={s.id}
                href={`/stylists/${s.slug}`}
                className="group block bg-white border border-zinc-200 rounded-2xl p-8 hover:border-zinc-900 hover:shadow-lg transition-all"
              >
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-2" lang={fallbackLang(s.translated)}>{s.role}</p>
                <h3 className="text-2xl font-serif text-zinc-900 group-hover:text-zinc-700 transition-colors">
                  {s.name}
                </h3>
                <span className="inline-flex items-center gap-2 mt-4 text-sm font-bold uppercase tracking-[0.15em] text-zinc-900 group-hover:text-zinc-600 transition-colors">
                  {t('detail.viewProfile')}
                  <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
