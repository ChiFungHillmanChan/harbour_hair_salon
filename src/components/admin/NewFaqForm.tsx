'use client';

import { useActionState } from 'react';
import type { FaqActionState } from '@/app/actions/admin-faqs';
import { BilingualContentEditor } from './BilingualContentEditor';
import { useT } from '@/i18n/client';
import { usePreservedForm } from '@/i18n/draft-store';

type FormAction = (prev: FaqActionState, formData: FormData) => Promise<FaqActionState>;

interface NewFaqFormProps {
  action: FormAction;
  existingKeys: string[];
  presetKey?: string;
}

/**
 * A new FAQ goes live only with its question and answer in both languages
 * (the embedded bilingual editor); the page key and position are plain
 * settings. A successful create redirects to the list.
 */
export function NewFaqForm({ action, existingKeys, presetKey }: NewFaqFormProps) {
  const t = useT('adminContent');
  const formRef = usePreservedForm('faq-form:new');
  const [state, formAction, pending] = useActionState<FaqActionState, FormData>(action, {
    status: 'idle',
  });

  return (
    <form ref={formRef} action={formAction} className="space-y-6">
      {state.status === 'error' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm" role="alert">
          {state.message}
        </div>
      )}

      <BilingualContentEditor mode="create" type="FAQ" />

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('faqs.form.placementTitle')}</h2>
        <div>
          <label htmlFor="faq-key" className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            {t('faqs.form.key')} *
          </label>
          <input
            id="faq-key"
            type="text"
            name="key"
            required
            list="faq-keys"
            defaultValue={presetKey ?? ''}
            placeholder={t('faqs.form.keyPlaceholder')}
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
          <datalist id="faq-keys">
            {existingKeys.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
          <p className="text-xs text-zinc-500 mt-1">{t('faqs.form.keyHelp')}</p>
        </div>

        <div>
          <label htmlFor="faq-sort" className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            {t('faqs.form.sortOrder')}
          </label>
          <input
            id="faq-sort"
            type="number"
            name="sortOrder"
            min={0}
            max={10000}
            defaultValue={0}
            className="w-32 border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>
      </section>

      <button
        type="submit"
        disabled={pending}
        className="bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded disabled:opacity-50"
      >
        {pending ? t('faqs.form.creating') : t('faqs.form.create')}
      </button>
    </form>
  );
}
