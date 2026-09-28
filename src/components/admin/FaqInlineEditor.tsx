'use client';

import { useActionState, useEffect } from 'react';
import type { FaqActionState } from '@/app/actions/admin-faqs';
import { useT } from '@/i18n/client';
import { clearDraft, usePreservedForm } from '@/i18n/draft-store';

type FormAction = (prev: FaqActionState, formData: FormData) => Promise<FaqActionState>;

interface FaqInlineEditorProps {
  faq: {
    id: string;
    key: string;
    sortOrder: number;
  };
  action: FormAction;
}

/**
 * Where an FAQ appears (page key) and its position — saved immediately. The
 * question and answer are edited in both languages on the FAQ's own page.
 */
export function FaqInlineEditor({ faq, action }: FaqInlineEditorProps) {
  const t = useT('adminContent');
  const tc = useT('common');
  const draftKey = `faq-placement:${faq.id}`;
  const formRef = usePreservedForm(draftKey);
  const [state, formAction, pending] = useActionState<FaqActionState, FormData>(action, {
    status: 'idle',
  });

  useEffect(() => {
    if (state.status === 'success') clearDraft(draftKey);
  }, [state.status, draftKey]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={faq.id} />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`faq-key-${faq.id}`} className="block text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1">
            {t('faqs.form.key')}
          </label>
          <input
            id={`faq-key-${faq.id}`}
            type="text"
            name="key"
            required
            defaultValue={faq.key}
            className="w-56 border border-zinc-300 rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
        </div>
        <div>
          <label htmlFor={`faq-order-${faq.id}`} className="block text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1">
            {t('faqs.form.sortOrder')}
          </label>
          <input
            id={`faq-order-${faq.id}`}
            type="number"
            name="sortOrder"
            min={0}
            max={10000}
            defaultValue={faq.sortOrder}
            className="w-24 border border-zinc-300 rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-1.5 rounded transition-colors disabled:opacity-50"
        >
          {pending ? tc('actions.saving') : t('faqs.list.savePlacement')}
        </button>
      </div>

      {state.status === 'error' && (
        <p className="text-xs text-red-600" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-emerald-600" role="status">✓ {t('faqs.list.placementSaved')}</p>
      )}
    </form>
  );
}
