'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { requestPasswordReset, type RequestResetState } from '@/app/actions/password-reset';

const initialState: RequestResetState = { status: 'idle' };

export default function ForgotPasswordPage() {
  const [state, action, isPending] = useActionState(requestPasswordReset, initialState);

  return (
    <div className="flex min-h-[100svh] items-center justify-center bg-zinc-50 py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-white p-6 sm:p-10 shadow-xl rounded-xl">
        <div className="text-center">
          <h1 className="mt-2 sm:mt-6 text-2xl sm:text-3xl font-serif font-bold tracking-tight text-zinc-900">
            Forgot your password?
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Enter your email address and we&apos;ll send you a link to set a new one.
          </p>
        </div>

        {state.status === 'sent' ? (
          <div
            role="status"
            className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-center text-sm text-zinc-700"
          >
            {state.message}
          </div>
        ) : (
          <form action={action} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium leading-6 text-zinc-900 mb-2">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="block w-full rounded-md border-0 py-3 px-4 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-black sm:text-sm sm:leading-6 transition-all"
                placeholder="Enter your email"
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
              {isPending ? 'Sending...' : 'Send reset link'}
            </button>
          </form>
        )}

        <div className="text-center text-sm text-zinc-500">
          Remembered it?{' '}
          <Link href="/auth/signin" className="font-semibold text-zinc-900 hover:text-zinc-700">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
