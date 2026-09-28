'use client';

import { Suspense, useActionState, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Link from '@/i18n/link';
import { resetPassword, type ResetPasswordState } from '@/app/actions/password-reset';
import PasswordVisibilityToggle from '@/components/auth/PasswordVisibilityToggle';
import { useT } from '@/i18n/client';
import { clearDraft, saveDraft, useDraftState, usePreservedForm } from '@/i18n/draft-store';

const initialState: ResetPasswordState = { status: 'idle' };

// The typed passwords, and the "password updated" result, survive a language
// switch (memory only). The token stays in the URL, where the email put it.
const DRAFT = 'auth:reset-password';

function ResetPasswordFormInner() {
  const t = useT('auth');
  const formRef = usePreservedForm(DRAFT);
  const pathname = usePathname() ?? '/';
  // The server action itself (see ForgotPasswordForm); the result is mirrored
  // into the in-memory draft store so a language switch keeps showing it.
  const [state, action, isPending] = useActionState(resetPassword, initialState);
  const [restoredDone] = useDraftState(`${DRAFT}:done`, false);
  const done = state.status === 'success' || restoredDone;
  useEffect(() => {
    if (state.status !== 'success') return;
    clearDraft(DRAFT);
    saveDraft(`${DRAFT}:done`, pathname, true);
  }, [state.status, pathname]);
  const [showPassword, setShowPassword] = useState(false);
  const token = useSearchParams().get('token') ?? '';

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-[100svh] items-center justify-center bg-zinc-50 py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-white p-6 sm:p-10 shadow-xl rounded-xl">{children}</div>
    </div>
  );

  // No token in the URL at all — send them back to request a fresh link rather
  // than showing a form that can only fail.
  if (!token) {
    return shell(
      <>
        <div className="text-center">
          <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-zinc-900">
            {t('reset.missingTitle')}
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            {t('reset.missingBody')}
          </p>
        </div>
        <Link
          href="/auth/forgot-password"
          className="flex w-full justify-center rounded-md bg-zinc-900 px-3 py-3 text-sm font-semibold text-white hover:bg-zinc-800 transition-all"
        >
          {t('reset.requestLink')}
        </Link>
      </>,
    );
  }

  if (done) {
    return shell(
      <>
        <div className="text-center">
          <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-zinc-900">
            {t('reset.doneTitle')}
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            {t('reset.doneBody')}
          </p>
        </div>
        <Link
          href="/auth/signin"
          className="flex w-full justify-center rounded-md bg-zinc-900 px-3 py-3 text-sm font-semibold text-white hover:bg-zinc-800 transition-all"
        >
          {t('reset.signIn')}
        </Link>
      </>,
    );
  }

  return shell(
    <>
      <div className="text-center">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-zinc-900">
          {t('reset.title')}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">{t('reset.subtitle')}</p>
      </div>

      {/* React empties the fields after each attempt; the draft follows. */}
      <form ref={formRef} action={action} onReset={() => clearDraft(DRAFT)} className="space-y-6">
        <input type="hidden" name="token" value={token} />

        <div>
          <label htmlFor="password" className="block text-sm font-medium leading-6 text-zinc-900 mb-2">
            {t('reset.newPassword')}
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={8}
              required
              className="block w-full rounded-md border-0 py-3 pl-4 pr-12 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-black sm:text-sm sm:leading-6 transition-all"
              placeholder={t('reset.newPasswordPlaceholder')}
            />
            <PasswordVisibilityToggle
              visible={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium leading-6 text-zinc-900 mb-2">
            {t('reset.confirmPassword')}
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={8}
            required
            className="block w-full rounded-md border-0 py-3 px-4 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-black sm:text-sm sm:leading-6 transition-all"
            placeholder={t('reset.confirmPasswordPlaceholder')}
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
          {isPending ? t('reset.submitting') : t('reset.submit')}
        </button>
      </form>

      <div className="text-center text-sm text-zinc-500">
        <Link href="/auth/forgot-password" className="font-semibold text-zinc-900 hover:text-zinc-700">
          {t('reset.requestNew')}
        </Link>
      </div>
    </>,
  );
}

export function ResetPasswordForm() {
  return (
    <Suspense>
      <ResetPasswordFormInner />
    </Suspense>
  );
}
