'use client';

import { useActionState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from '@/i18n/link';
import { requestPasswordReset, type RequestResetState } from '@/app/actions/password-reset';
import { useT } from '@/i18n/client';
import { clearDraft, saveDraft, useDraftState, usePreservedForm } from '@/i18n/draft-store';

const initialState: RequestResetState = { status: 'idle' };

// The typed address, and the "we've sent it" confirmation, survive a language
// switch (memory only). The email itself goes out in this page's language.
const DRAFT = 'auth:forgot-password';

export function ForgotPasswordForm() {
  const t = useT('auth');
  const formRef = usePreservedForm(DRAFT);
  const pathname = usePathname() ?? '/';
  // The server action itself, never a client wrapper, so the form submits before
  // hydration or without JavaScript. The confirmation is mirrored into the
  // in-memory draft store so a language switch (a remount) keeps showing it.
  const [state, action, isPending] = useActionState(requestPasswordReset, initialState);
  const [restoredSent] = useDraftState(`${DRAFT}:sent`, false);
  const sent = state.status === 'sent' || restoredSent;
  useEffect(() => {
    if (state.status !== 'sent') return;
    clearDraft(DRAFT);
    saveDraft(`${DRAFT}:sent`, pathname, true);
  }, [state.status, pathname]);

  return (
    <div className="flex min-h-[100svh] items-center justify-center bg-zinc-50 py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-white p-6 sm:p-10 shadow-xl rounded-xl">
        <div className="text-center">
          <h1 className="mt-2 sm:mt-6 text-2xl sm:text-3xl font-serif font-bold tracking-tight text-zinc-900">
            {t('forgot.title')}
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            {t('forgot.subtitle')}
          </p>
        </div>

        {sent ? (
          <div
            role="status"
            className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-center text-sm text-zinc-700"
          >
            {t('forgot.sent')}
          </div>
        ) : (
          // React empties the field after each attempt; the draft follows.
          <form ref={formRef} action={action} onReset={() => clearDraft(DRAFT)} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium leading-6 text-zinc-900 mb-2">
                {t('fields.email')}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="block w-full rounded-md border-0 py-3 px-4 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-black sm:text-sm sm:leading-6 transition-all"
                placeholder={t('fields.emailPlaceholder')}
              />
            </div>

            {state.status === 'error' && (
              <div
                role="alert"
                className="p-4 rounded-md bg-red-50 text-red-600 text-sm text-center border border-red-100"
              >
                {state.message}
              </div>
            )}

            <button
              type="submit"
              disabled={isPending}
              className="flex w-full justify-center rounded-md bg-zinc-900 px-3 py-3 text-sm font-semibold text-white hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-70 transition-all"
            >
              {isPending ? t('forgot.submitting') : t('forgot.submit')}
            </button>
          </form>
        )}

        <div className="text-center text-sm text-zinc-500">
          {t('forgot.remembered')}{' '}
          <Link href="/auth/signin" className="font-semibold text-zinc-900 hover:text-zinc-700">
            {t('forgot.backToSignIn')}
          </Link>
        </div>
      </div>
    </div>
  );
}
