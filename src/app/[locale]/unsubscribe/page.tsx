import type { Metadata } from 'next';
import Link from '@/i18n/link';
import { ConfirmUnsubscribeForm, UnsubscribeForm } from '@/components/newsletter/UnsubscribeForm';
import { verifyUnsubscribeToken } from '@/app/lib/unsubscribe-token';
import { getLocale, getT } from '@/i18n/server';
import { ClientMessages } from '@/i18n/ClientMessages';
import { alternatesFor } from '@/i18n/metadata';
import { rich } from '@/i18n/rich';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('legal')]);
  return {
    title: t('unsubscribe.meta.title'),
    description: t('unsubscribe.meta.description'),
    // Never the token: canonical/hreflang name the bare page.
    alternates: alternatesFor(locale, '/unsubscribe'),
    robots: { index: false, follow: false },
    // An emailed link carries a signed token; don't hand it on to anyone.
    referrer: 'no-referrer',
  };
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; token?: string }>;
}) {
  const { email, token } = await searchParams;
  const t = await getT('legal');
  // Only chooses what to show; confirmUnsubscribe verifies the token again.
  const linkEmail = typeof token === 'string' ? await verifyUnsubscribeToken(token) : null;
  return (
    <div className="min-h-screen bg-zinc-50 py-16 px-4">
      <div className="mx-auto max-w-md rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="font-serif text-3xl text-zinc-900 mb-3">{t('unsubscribe.title')}</h1>
        <ClientMessages namespaces={['legal']}>
          {linkEmail && typeof token === 'string' ? (
            <ConfirmUnsubscribeForm token={token} email={linkEmail} />
          ) : (
            <>
              {token && (
                <p role="alert" className="text-sm text-red-700 mb-4">{t('unsubscribe.results.INVALID_LINK')}</p>
              )}
              <p className="text-sm leading-6 text-zinc-600 mb-8">
                {t('unsubscribe.intro')}
              </p>
              <UnsubscribeForm defaultEmail={typeof email === 'string' ? email : ''} />
            </>
          )}
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
