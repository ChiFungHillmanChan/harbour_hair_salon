import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor, ogLocale } from '@/i18n/metadata';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('auth')]);
  return {
    title: t('meta.register.title'),
    description: t('meta.register.description'),
    alternates: alternatesFor(locale, '/auth/register'),
    robots: { index: false, follow: false },
    openGraph: { ...OG_BASE, ...ogLocale(locale), title: t('meta.register.title'), description: t('meta.register.description') },
  };
}

export default function RegisterPage() {
  return <RegisterForm />;
}
