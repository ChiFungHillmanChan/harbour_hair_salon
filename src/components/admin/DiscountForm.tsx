'use client';

import { useActionState, useEffect } from 'react';
import { createDiscountCode, type DiscountActionState } from '@/app/actions/admin';
import { useT } from '@/i18n/client';
import { clearDraft, usePreservedForm } from '@/i18n/draft-store';

const DRAFT_KEY = 'discount-form:new';

export function DiscountForm() {
  const t = useT('adminContent');
  const formRef = usePreservedForm(DRAFT_KEY);
  const [state, formAction, pending] = useActionState<DiscountActionState, FormData>(
    createDiscountCode,
    {}
  );

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      clearDraft(DRAFT_KEY);
    }
  }, [state, formRef]);

  const input = 'w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900';
  const label = 'block text-sm font-medium text-zinc-700 mb-1';

  return (
    <div className="bg-white p-6 rounded-lg shadow border border-zinc-200 mb-8">
      <h3 className="text-lg font-bold mb-4">{t('discounts.form.createTitle')}</h3>
      <form ref={formRef} action={formAction} className="space-y-4">
        {state.error && (
          <div
            className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm"
            role="alert"
          >
            {state.error}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="discount-code" className={label}>{t('discounts.form.code')}</label>
            <input
              id="discount-code"
              type="text"
              name="code"
              required
              placeholder={t('discounts.form.codePlaceholder')}
              className={input}
            />
          </div>
          <div>
            <label htmlFor="discount-type" className={label}>{t('discounts.form.type')}</label>
            <select id="discount-type" name="type" className={input}>
              <option value="PERCENTAGE">{t('promotions.types.PERCENTAGE')}</option>
              <option value="FIXED">{t('promotions.types.FIXED')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="discount-value" className={label}>{t('discounts.form.value')}</label>
            <input
              id="discount-value"
              type="number"
              step="0.01"
              name="value"
              required
              placeholder={t('discounts.form.valuePlaceholder')}
              className={input}
            />
          </div>
          <div>
            <label htmlFor="discount-max-uses" className={label}>{t('discounts.form.maxUses')}</label>
            <input
              id="discount-max-uses"
              type="number"
              name="maxUses"
              placeholder={t('discounts.form.maxUsesPlaceholder')}
              className={input}
            />
          </div>
          <div>
            <label htmlFor="discount-expires" className={label}>{t('discounts.form.expiresAt')}</label>
            <input
              id="discount-expires"
              type="datetime-local"
              name="expiresAt"
              className={input}
            />
          </div>
        </div>
        <div className="flex justify-end items-center gap-3">
          {state.success && <span className="text-xs text-emerald-600" role="status">✓ {t('discounts.form.created')}</span>}
          <button
            type="submit"
            disabled={pending}
            className="bg-zinc-900 text-white px-6 py-2 rounded-md hover:bg-zinc-800 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {pending ? t('discounts.form.creating') : t('discounts.form.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
