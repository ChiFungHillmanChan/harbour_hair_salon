'use client';

import { useActionState, useEffect } from 'react';
import { createOffer, type OfferActionState } from '@/app/actions/admin';
import { BilingualContentEditor } from './BilingualContentEditor';
import { useT } from '@/i18n/client';
import { clearDraft, usePreservedForm } from '@/i18n/draft-store';

const DRAFT_KEY = 'offer-form:new';

/**
 * Creates an offer: the discount settings plus its title/description in both
 * languages (a new offer never goes live English-only). `latestOfferId`
 * changes after a successful create, which gives the embedded text editor a
 * fresh, empty instance for the next offer.
 */
export function OfferForm({ latestOfferId }: { latestOfferId: string | null }) {
  const t = useT('adminContent');
  const formRef = usePreservedForm(DRAFT_KEY);
  const [state, formAction, pending] = useActionState<OfferActionState, FormData>(
    createOffer,
    {}
  );

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      clearDraft(DRAFT_KEY);
    }
  }, [state, formRef]);

  return (
    <details className="bg-white rounded-lg border border-zinc-200 mb-4 sm:mb-8">
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold sm:px-6 sm:text-base">{t('offers.form.createTitle')}</summary>
      <form ref={formRef} action={formAction} className="space-y-4 border-t border-zinc-200 p-4 sm:p-6">
        {state.error && (
          <div
            className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm"
            role="alert"
          >
            {state.error}
          </div>
        )}
        <BilingualContentEditor key={latestOfferId ?? 'none'} mode="create" type="OFFER" />
        <div className="grid grid-cols-1 gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="offer-new-type" className="block text-sm font-medium text-zinc-700 mb-1">{t('promotions.discountType')}</label>
              <select
                id="offer-new-type"
                name="discountType"
                className="min-h-11 min-w-0 w-full max-w-full px-3 py-2 text-base sm:text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
              >
                <option value="PERCENTAGE">{t('promotions.types.PERCENTAGE')}</option>
                <option value="FIXED">{t('promotions.types.FIXED')}</option>
              </select>
            </div>
            <div>
              <label htmlFor="offer-new-value" className="block text-sm font-medium text-zinc-700 mb-1">{t('promotions.discountValue')}</label>
              <input
                id="offer-new-value"
                type="number"
                step="0.01"
                name="discountValue"
                required
                placeholder={t('offers.form.valuePlaceholder')}
                className="min-h-11 min-w-0 w-full max-w-full px-3 py-2 text-base sm:text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isGlobal"
              name="isGlobal"
              className="shrink-0 w-4 h-4 text-zinc-900 border-zinc-300 rounded focus:ring-zinc-900"
            />
            <label htmlFor="isGlobal" className="flex min-h-11 items-center text-sm font-medium text-zinc-700">
              {t('offers.form.isGlobal')}
            </label>
          </div>
        </div>
        <div className="flex flex-wrap justify-end items-center gap-3">
          {state.success && <span className="text-xs text-emerald-600" role="status">✓ {t('offers.form.created')}</span>}
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 bg-zinc-900 text-white px-6 py-2 rounded-md hover:bg-zinc-800 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {pending ? t('offers.form.creating') : t('offers.form.create')}
          </button>
        </div>
      </form>
    </details>
  );
}
