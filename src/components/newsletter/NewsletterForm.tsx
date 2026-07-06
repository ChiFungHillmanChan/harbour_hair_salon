'use client';

import { useActionState } from 'react';
import { subscribeToNewsletter } from '@/app/actions/newsletter';

type Variant = 'inline' | 'card';

interface NewsletterFormProps {
  variant?: Variant;
  source?: string;
  title?: string;
  description?: string;
}

const initialState = { status: 'idle' as const };

export function NewsletterForm({
  variant = 'inline',
  source = 'site',
  title = 'Stay in the loop',
  description = 'Seasonal offers and stylist tips, straight to your inbox. No spam.',
}: NewsletterFormProps) {
  const [state, formAction, pending] = useActionState(subscribeToNewsletter, initialState);

  if (variant === 'card') {
    return (
      <section className="relative bg-zinc-900 text-white rounded-2xl overflow-hidden">
        <div className="relative z-10 px-8 py-16 md:px-16 md:py-20 text-center">
          <div className="w-12 h-[2px] bg-white mx-auto mb-6" />
          <h2 className="text-3xl md:text-4xl font-serif tracking-tight mb-4">
            {title}
          </h2>
          <p className="text-zinc-400 max-w-xl mx-auto font-light leading-relaxed mb-10">
            {description}
          </p>

          {state.status === 'success' ? (
            <p className="text-white text-sm uppercase tracking-[0.2em] font-bold">
              You&apos;re on the list. Check your inbox.
            </p>
          ) : (
            <form action={formAction} className="max-w-md mx-auto">
              <input type="hidden" name="source" value={source} />
              <div className="flex flex-col sm:flex-row gap-3">
                <label className="sr-only" htmlFor={`nl-email-${source}`}>
                  Email address
                </label>
                <input
                  id={`nl-email-${source}`}
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="flex-1 bg-white/5 border border-white/20 rounded-md px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent"
                />
                <button
                  type="submit"
                  disabled={pending}
                  className="bg-white text-black px-8 py-3 text-xs uppercase tracking-[0.15em] font-bold hover:bg-zinc-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                >
                  {pending ? 'Sending…' : 'Subscribe'}
                </button>
              </div>
              {state.status === 'error' && (
                <p className="mt-3 text-xs text-red-300" role="alert">
                  {state.message}
                </p>
              )}
              <p className="mt-3 text-[11px] text-zinc-500">
                By subscribing you agree to receive occasional marketing emails from Harbour Hair Salon.
                Unsubscribe any time. See our <a href="/privacy" className="underline hover:text-zinc-300">privacy policy</a>.
              </p>
            </form>
          )}
        </div>
      </section>
    );
  }

  // Inline variant — form only, caller provides heading/copy
  if (state.status === 'success') {
    return (
      <p className="text-white text-xs uppercase tracking-[0.15em] font-bold">
        Thanks — check your inbox.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col sm:flex-row gap-2">
      <input type="hidden" name="source" value={source} />
      <label className="sr-only" htmlFor={`nl-inline-${source}`}>
        Email address
      </label>
      <input
        id={`nl-inline-${source}`}
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        className="flex-1 bg-white/5 border border-white/20 rounded px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-white focus:border-transparent"
      />
      <button
        type="submit"
        disabled={pending}
        className="bg-white text-black px-6 py-2.5 text-xs uppercase tracking-[0.15em] font-bold hover:bg-zinc-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed rounded whitespace-nowrap"
      >
        {pending ? 'Sending…' : 'Subscribe'}
      </button>
      {state.status === 'error' && (
        <p className="text-xs text-red-400 w-full" role="alert">
          {state.message}
        </p>
      )}
      <p className="text-[11px] text-zinc-500 sm:basis-full">
        Marketing emails only. <a href="/privacy" className="underline hover:text-zinc-300">Privacy policy</a>.
      </p>
    </form>
  );
}
