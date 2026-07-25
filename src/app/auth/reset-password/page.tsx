'use client';

import { Suspense, useActionState, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { resetPassword, type ResetPasswordState } from '@/app/actions/password-reset';
import PasswordVisibilityToggle from '@/components/auth/PasswordVisibilityToggle';

const initialState: ResetPasswordState = { status: 'idle' };

function ResetPasswordForm() {
  const [state, action, isPending] = useActionState(resetPassword, initialState);
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
            Reset link missing
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            This page needs a valid reset link. Please request a new one.
          </p>
        </div>
        <Link
          href="/auth/forgot-password"
          className="flex w-full justify-center rounded-md bg-zinc-900 px-3 py-3 text-sm font-semibold text-white hover:bg-zinc-800 transition-all"
        >
          Request a reset link
        </Link>
      </>,
    );
  }

  if (state.status === 'success') {
    return shell(
      <>
        <div className="text-center">
          <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-zinc-900">
            Password updated
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Your password has been changed and you have been signed out everywhere else.
          </p>
        </div>
        <Link
          href="/auth/signin"
          className="flex w-full justify-center rounded-md bg-zinc-900 px-3 py-3 text-sm font-semibold text-white hover:bg-zinc-800 transition-all"
        >
          Sign in
        </Link>
      </>,
    );
  }

  return shell(
    <>
      <div className="text-center">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-zinc-900">
          Choose a new password
        </h1>
        <p className="mt-2 text-sm text-zinc-600">Must be at least 8 characters.</p>
      </div>

      <form action={action} className="space-y-6">
        <input type="hidden" name="token" value={token} />

        <div>
          <label htmlFor="password" className="block text-sm font-medium leading-6 text-zinc-900 mb-2">
            New password
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
              placeholder="Enter a new password"
            />
            <PasswordVisibilityToggle
              visible={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium leading-6 text-zinc-900 mb-2">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={8}
            required
            className="block w-full rounded-md border-0 py-3 px-4 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-black sm:text-sm sm:leading-6 transition-all"
            placeholder="Re-enter the new password"
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
          {isPending ? 'Updating...' : 'Update password'}
        </button>
      </form>

      <div className="text-center text-sm text-zinc-500">
        <Link href="/auth/forgot-password" className="font-semibold text-zinc-900 hover:text-zinc-700">
          Request a new link
        </Link>
      </div>
    </>,
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
