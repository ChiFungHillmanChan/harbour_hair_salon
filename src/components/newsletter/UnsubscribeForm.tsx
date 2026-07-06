'use client';

import { useActionState } from 'react';
import {
  unsubscribeFromMarketing,
  type UnsubscribeState,
} from '@/app/actions/unsubscribe';

const initialState: UnsubscribeState = { status: 'idle' };

export function UnsubscribeForm() {
  const [state, action, pending] = useActionState(unsubscribeFromMarketing, initialState);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-zinc-800 mb-2">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full rounded-md border border-zinc-300 px-4 py-3 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="you@example.com"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-5 py-3 text-sm font-bold uppercase tracking-[0.15em] text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Updating...' : 'Unsubscribe'}
      </button>
      {state.status !== 'idle' && (
        <p
          className={state.status === 'success' ? 'text-sm text-green-700' : 'text-sm text-red-700'}
          role="status"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
