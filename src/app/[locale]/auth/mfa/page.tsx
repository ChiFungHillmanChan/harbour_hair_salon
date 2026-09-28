import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requirePendingAdminMfa } from '@/app/lib/admin-mfa';
import { AdminMfaVerifyForm } from '@/components/auth/AdminMfaForms';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor } from '@/i18n/metadata';
import { localizedPath } from '@/i18n/request';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('auth')]);
  return { title: t('meta.mfa.title'), alternates: alternatesFor(locale, '/auth/mfa'), robots: { index: false, follow: false } };
}

export default async function AdminMfaPage() {
  const user = await requirePendingAdminMfa();
  if (!user.mfaEnabledAt) redirect(await localizedPath('/auth/mfa/setup'));
  const t = await getT('auth');
  return <main className="flex min-h-[100svh] items-center justify-center bg-zinc-50 px-4 py-12"><div className="w-full max-w-md space-y-6 rounded-xl bg-white p-8 shadow-xl"><h1 className="font-serif text-3xl text-zinc-900">{t('mfa.verify.heading')}</h1><p className="text-sm text-zinc-600">{t('mfa.verify.intro')}</p><AdminMfaVerifyForm /></div></main>;
}
