import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor, ogLocale } from '@/i18n/metadata';
import Salon3DFrame from './Salon3DFrame';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('salon3d')]);
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: alternatesFor(locale, '/3d'),
    openGraph: {
      ...OG_BASE,
      ...ogLocale(locale),
      title: t('meta.ogTitle'),
      description: t('meta.description'),
    },
    twitter: {
      card: 'summary_large_image',
      title: t('meta.ogTitle'),
      description: t('meta.description'),
      images: OG_BASE.images,
    },
  };
}

export default async function Salon3DPage() {
  const t = await getT('salon3d');

  return (
    <section aria-labelledby="salon-3d-heading" className="flex h-[calc(100svh-4.5rem)] flex-col bg-[#101e2b] text-white sm:h-[calc(100svh-5rem)]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-white/10 px-4 py-3 sm:px-6 lg:px-8 [@media(max-height:500px)]:py-1">
        <div>
          <h1 id="salon-3d-heading" className="text-lg font-serif tracking-wide sm:text-xl [@media(max-height:500px)]:text-base">{t('heading')}</h1>
          <p className="mt-1 text-xs leading-relaxed text-slate-300 sm:text-sm [@media(max-height:500px)]:hidden">{t('intro')}</p>
        </div>
        <a
          href="/harbour-hair-3d.html"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-white/20 px-3 text-xs font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {t('openStandalone')}
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M11 3h6v6M17 3l-8 8M8 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>
      <div className="min-h-0 flex-1">
        <Salon3DFrame title={t('frameTitle')} />
      </div>
      <p className="shrink-0 border-t border-white/10 px-4 py-2 text-[11px] leading-relaxed text-slate-400 sm:px-6 lg:px-8 [@media(max-height:500px)]:hidden">{t('note')}</p>
    </section>
  );
}
