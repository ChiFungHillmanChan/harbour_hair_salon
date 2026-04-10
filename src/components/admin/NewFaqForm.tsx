'use client';

import { useActionState } from 'react';
import type { FaqActionState } from '@/app/actions/admin-faqs';

type FormAction = (prev: FaqActionState, formData: FormData) => Promise<FaqActionState>;

interface NewFaqFormProps {
  action: FormAction;
  existingKeys: string[];
  presetKey?: string;
}

export function NewFaqForm({ action, existingKeys, presetKey }: NewFaqFormProps) {
  const [state, formAction, pending] = useActionState<FaqActionState, FormData>(action, {
    status: 'idle',
  });

  return (
    <form action={formAction} className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
      {state.status === 'error' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm" role="alert">
          {state.message}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
          Page key *
        </label>
        <input
          type="text"
          name="key"
          required
          list="faq-keys"
          defaultValue={presetKey ?? ''}
          placeholder="e.g. home, contact, services-master, category:haircuts"
          className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        />
        <datalist id="faq-keys">
          {existingKeys.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
        <p className="text-xs text-zinc-500 mt-1">
          Lowercase letters, digits, dashes, and colons only. Must match the key used by a page.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
          Question *
        </label>
        <input
          type="text"
          name="question"
          required
          minLength={5}
          maxLength={300}
          placeholder="e.g. What are your opening hours?"
          className="w-full border border-zinc-300 rounded px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
          Answer *
        </label>
        <textarea
          name="answer"
          required
          minLength={10}
          maxLength={2000}
          rows={4}
          placeholder="Full answer paragraph."
          className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
          Sort order
        </label>
        <input
          type="number"
          name="sortOrder"
          min={0}
          max={10000}
          defaultValue={0}
          className="w-32 border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create FAQ'}
      </button>
    </form>
  );
}
