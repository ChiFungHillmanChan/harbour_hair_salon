import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import { SignInForm } from '@/components/auth/SignInForm';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor, ogLocale } from '@/i18n/metadata';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('auth')]);
  return {
    title: t('meta.signIn.title'),
    description: t('meta.signIn.description'),
    alternates: alternatesFor(locale, '/auth/signin'),
    robots: { index: false, follow: false },
    openGraph: { ...OG_BASE, ...ogLocale(locale), title: t('meta.signIn.title'), description: t('meta.signIn.description') },
  };
}

export default function SignInPage() {
  return <SignInForm />;
}
