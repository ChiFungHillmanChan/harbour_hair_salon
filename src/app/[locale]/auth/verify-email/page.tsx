import type { Metadata } from 'next';
import prisma from '@/app/lib/prisma';
import { getSession } from '@/app/lib/session';
import { EMAIL_VERIFICATION_SELECT, hasVerifiedEmail } from '@/app/lib/email-verification';
import { VerifyEmailResendForm } from '@/components/auth/VerifyEmailResendForm';
import { ClientMessages } from '@/i18n/ClientMessages';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor } from '@/i18n/metadata';
import { localizeHref } from '@/i18n/paths';
import Link from '@/i18n/link';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('auth')]);
  return { title: t('meta.verifyEmail.title'), alternates: alternatesFor(locale, '/auth/verify-email'), robots: { index: false, follow: false } };
}

const buttonClass = 'inline-block bg-zinc-900 text-white px-8 py-3 rounded-md font-medium hover:bg-zinc-700 transition-colors';

/**
 * Where the verification link lands (via /api/auth/verify-email, which does the
 * work). `status` only picks the wording: it grants nothing, and booking
 * re-checks the account itself.
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const [locale, t, { status }] = await Promise.all([getLocale(), getT('auth'), searchParams]);
  const verified = status === 'verified';

  // A failed link from a signed-in customer who still needs one: offer a new
  // link right here. Anyone else is pointed at the next step.
  const session = verified ? null : await getSession();
  const account = session?.userId
    ? await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true, ...EMAIL_VERIFICATION_SELECT } })
    : null;

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-md space-y-6 rounded-xl bg-white p-8 text-center shadow-xl">
        <h1 className="font-serif text-3xl text-zinc-900">{verified ? t('verifyEmail.verifiedTitle') : t('verifyEmail.invalidTitle')}</h1>
        <p className="text-zinc-600">{verified ? t('verifyEmail.verifiedBody') : t('verifyEmail.invalidBody')}</p>
        {verified || (account && hasVerifiedEmail(account)) ? (
          <Link href="/book" className={buttonClass}>{t('verifyEmail.bookNow')}</Link>
        ) : account ? (
          <ClientMessages sections={{ auth: ['verifyEmail'] }}>
            <VerifyEmailResendForm email={account.email} />
          </ClientMessages>
        ) : (
          <Link href={`/auth/signin?redirect=${encodeURIComponent(localizeHref(locale, '/book'))}`} className={buttonClass}>{t('verifyEmail.signIn')}</Link>
        )}
      </div>
    </main>
  );
}
