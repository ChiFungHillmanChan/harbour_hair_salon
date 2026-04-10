'use client';

import { useActionState } from 'react';
import type { FaqActionState } from '@/app/actions/admin-faqs';

type FormAction = (prev: FaqActionState, formData: FormData) => Promise<FaqActionState>;

interface FaqInlineEditorProps {
  faq: {
    id: string;
    key: string;
    question: string;
    answer: string;
    sortOrder: number;
  };
  action: FormAction;
}

export function FaqInlineEditor({ faq, action }: FaqInlineEditorProps) {
  const [state, formAction, pending] = useActionState<FaqActionState, FormData>(action, {
    status: 'idle',
  });

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={faq.id} />

      <div className="grid md:grid-cols-[1fr_8rem_8rem] gap-3">
        <input
          type="text"
          name="question"
          required
          minLength={5}
          maxLength={300}
          defaultValue={faq.question}
          placeholder="Question"
          className="border border-zinc-300 rounded px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-zinc-900"
        />
        <input
          type="text"
          name="key"
          required
          defaultValue={faq.key}
          className="border border-zinc-300 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900"
          title="Page key"
        />
        <input
          type="number"
          name="sortOrder"
          min={0}
          max={10000}
          defaultValue={faq.sortOrder}
          className="border border-zinc-300 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900"
          title="Sort order"
        />
      </div>

      <textarea
        name="answer"
        required
        minLength={10}
        maxLength={2000}
        rows={3}
        defaultValue={faq.answer}
        placeholder="Answer"
        className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
      />

      {state.status === 'error' && (
        <p className="text-xs text-red-600" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-emerald-600">✓ Saved</p>
      )}

      <div className="flex justify-start">
        <button
          type="submit"
          disabled={pending}
          className="text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-1.5 rounded transition-colors disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save row'}
        </button>
      </div>
    </form>
  );
}
