'use client';

import { Suspense, useActionState, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { login } from '@/app/actions/auth';
import Link from 'next/link';
import PasswordVisibilityToggle from '@/components/auth/PasswordVisibilityToggle';


function SignInForm() {
  const [state, action, isPending] = useActionState(login, undefined);
  const [showPassword, setShowPassword] = useState(false);
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get('redirect');

  return (
    <div className="flex min-h-[100svh] items-center justify-center bg-zinc-50 py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-white p-6 sm:p-10 shadow-xl rounded-xl">
        <div className="text-center">
          <h2 className="mt-2 sm:mt-6 text-2xl sm:text-3xl font-serif font-bold tracking-tight text-zinc-900">
            Welcome Back
          </h2>
          <p className="mt-2 text-sm text-zinc-600">
            Sign in to your account to manage appointments
          </p>
        </div>

        <form action={action} className="mt-8 space-y-8">
          <input type="hidden" name="redirect" value={redirectParam || ''} />
          <div className="space-y-6 rounded-md">
            <div className="relative">
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
            <div className="relative">
              <label htmlFor="password" className="block text-sm font-medium leading-6 text-zinc-900 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className="block w-full rounded-md border-0 py-3 pl-4 pr-12 text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-black sm:text-sm sm:leading-6 transition-all"
                  placeholder="Enter your password"
                />
                <PasswordVisibilityToggle
                  visible={showPassword}
                  onToggle={() => setShowPassword((v) => !v)}
                />
              </div>
            </div>
          </div>

          {state?.error && (
            <div className="p-4 rounded-md bg-red-50 text-red-600 text-sm text-center border border-red-100">
              {state.error}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={isPending}
              className="group relative flex w-full justify-center rounded-md bg-zinc-900 px-3 py-3 text-sm font-semibold text-white hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-70 transition-all"
            >
              {isPending ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>

        <div className="text-center text-sm text-zinc-500">
          Don&apos;t have an account?{' '}
          <Link href="/auth/register" className="font-semibold text-zinc-900 hover:text-zinc-700">
            Register here
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
