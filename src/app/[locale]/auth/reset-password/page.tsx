import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor, ogLocale } from '@/i18n/metadata';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('auth')]);
  return {
    title: t('meta.resetPassword.title'),
    description: t('meta.resetPassword.description'),
    // Never the token: canonical/hreflang name the bare page.
    alternates: alternatesFor(locale, '/auth/reset-password'),
    robots: { index: false, follow: false },
    openGraph: { ...OG_BASE, ...ogLocale(locale), title: t('meta.resetPassword.title'), description: t('meta.resetPassword.description') },
  };
}

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
