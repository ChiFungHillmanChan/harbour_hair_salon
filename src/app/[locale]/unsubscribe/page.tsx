import type { Metadata } from 'next';
import Link from '@/i18n/link';
import { UnsubscribeForm } from '@/components/newsletter/UnsubscribeForm';
import { getLocale, getT } from '@/i18n/server';
import { ClientMessages } from '@/i18n/ClientMessages';
import { alternatesFor } from '@/i18n/metadata';
import { rich } from '@/i18n/rich';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('legal')]);
  return {
    title: t('unsubscribe.meta.title'),
    description: t('unsubscribe.meta.description'),
    alternates: alternatesFor(locale, '/unsubscribe'),
    robots: { index: false, follow: false },
  };
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  const t = await getT('legal');
  return (
    <div className="min-h-screen bg-zinc-50 py-16 px-4">
      <div className="mx-auto max-w-md rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="font-serif text-3xl text-zinc-900 mb-3">{t('unsubscribe.title')}</h1>
        <p className="text-sm leading-6 text-zinc-600 mb-8">
          {t('unsubscribe.intro')}
        </p>
        <ClientMessages namespaces={['legal']}>
          <UnsubscribeForm defaultEmail={email ?? ''} />
        </ClientMessages>
        <p className="mt-6 text-sm text-zinc-500">
          {rich(t('unsubscribe.help'), {
            link: (text) => <Link href="/contact" className="text-zinc-900 underline">{text}</Link>,
          })}
        </p>
      </div>
    </div>
  );
}
