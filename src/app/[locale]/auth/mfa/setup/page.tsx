import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requirePendingAdminMfa } from '@/app/lib/admin-mfa';
import prisma from '@/app/lib/prisma';
import { getSession, requireAdmin } from '@/app/lib/session';
import { AdminMfaSetupForm } from '@/components/auth/AdminMfaForms';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor } from '@/i18n/metadata';
import { localizedPath } from '@/i18n/request';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('auth')]);
  return { title: t('meta.mfaSetup.title'), alternates: alternatesFor(locale, '/auth/mfa/setup'), robots: { index: false, follow: false } };
}

export default async function AdminMfaSetupPage() {
  let enrolled = false;
  let notEnabled = false;
  let requiresPassword = false;
  if (await getSession()) {
    // Finishing enrollment replaces the challenge cookie with a full session.
    // Next rerenders this page immediately; keep the same client form mounted
    // so its one-time recovery-code action result remains visible. A language
    // switch lands here too, and the form restores those codes from memory.
    const session = await requireAdmin();
    // A full session alone says nothing about a factor: sign-in no longer asks
    // for one (lib/session.ts). Report the account's real state, never "enabled"
    // for an administrator who has none.
    const account = await prisma.user.findUnique({ where: { id: session.userId }, select: { mfaEnabledAt: true } });
    enrolled = Boolean(account?.mfaEnabledAt);
    notEnabled = !enrolled;
  } else {
    const user = await requirePendingAdminMfa();
    if (user.mfaEnabledAt) redirect(await localizedPath('/auth/mfa'));
    requiresPassword = Boolean(user.password);
  }
  const t = await getT('auth');
  return <main className="flex min-h-[100svh] items-center justify-center bg-zinc-50 px-4 py-12"><div className="w-full max-w-md space-y-6 rounded-xl bg-white p-8 shadow-xl"><h1 className="font-serif text-3xl text-zinc-900">{t('mfa.setup.heading')}</h1><AdminMfaSetupForm requiresPassword={requiresPassword} enrolled={enrolled} notEnabled={notEnabled} /></div></main>;
}
