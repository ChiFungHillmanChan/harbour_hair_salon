import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor, ogLocale } from '@/i18n/metadata';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('auth')]);
  return {
    title: t('meta.forgotPassword.title'),
    description: t('meta.forgotPassword.description'),
    alternates: alternatesFor(locale, '/auth/forgot-password'),
    robots: { index: false, follow: false },
    openGraph: { ...OG_BASE, ...ogLocale(locale), title: t('meta.forgotPassword.title'), description: t('meta.forgotPassword.description') },
  };
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
