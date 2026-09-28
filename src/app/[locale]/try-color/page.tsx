import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import TryColorClient from './TryColorClient';
import { getLocale, getT } from '@/i18n/server';
import { ClientMessages } from '@/i18n/ClientMessages';
import { alternatesFor, ogLocale } from '@/i18n/metadata';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('tryColor')]);
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: alternatesFor(locale, '/try-color'),
    openGraph: {
      ...OG_BASE,
      ...ogLocale(locale),
      title: t('meta.ogTitle'),
      description: t('meta.ogDescription'),
    },
  };
}

export default function TryColorPage() {
  return (
    <ClientMessages namespaces={['tryColor']}>
      <TryColorClient />
    </ClientMessages>
  );
}
