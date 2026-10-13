import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { readEmailVerificationToken } from '@/app/lib/email-verification';
import { ConfirmEmailForm } from '@/components/auth/ConfirmEmailForm';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor } from '@/i18n/metadata';
import { localizeHref } from '@/i18n/paths';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('auth')]);
  return {
    title: t('meta.verifyEmail.title'),
    // Never the token: canonical/hreflang name the bare page.
    alternates: alternatesFor(locale, '/auth/verify-email/confirm'),
    robots: { index: false, follow: false },
    // The address carries a signed token; don't hand it on to anyone.
    referrer: 'no-referrer',
  };
}

/**
 * Where a verification email's link lands (directly, or forwarded by
 * /api/auth/verify-email for older emails). Opening it records nothing — mail
 * scanners open links too — so the customer presses a button, and
 * confirmEmailVerification checks the token again and does the work.
 *
 * Reads no database: a forged or expired token goes straight to the "not
 * valid" outcome, which offers a signed-in customer a new link.
 */
export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const [locale, t, { token }] = await Promise.all([getLocale(), getT('auth'), searchParams]);
  // Only chooses what to show; the action verifies the token itself.
  const claim = typeof token === 'string' ? await readEmailVerificationToken(token) : null;
  if (!claim || typeof token !== 'string') redirect(localizeHref(locale, '/auth/verify-email?status=invalid'));

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-md space-y-6 rounded-xl bg-white p-8 text-center shadow-xl">
        <h1 className="font-serif text-3xl text-zinc-900">{t('verifyEmail.confirmTitle')}</h1>
        <p className="break-words text-zinc-600">{t('verifyEmail.confirmBody', { email: claim.email })}</p>
        <ConfirmEmailForm token={token} />
      </div>
    </main>
  );
}
