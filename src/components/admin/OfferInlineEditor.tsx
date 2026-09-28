'use client';

import { useActionState, useEffect } from 'react';
import type { OfferActionState } from '@/app/actions/admin';
import { useT } from '@/i18n/client';
import { clearDraft, usePreservedForm } from '@/i18n/draft-store';

type FormAction = (prev: OfferActionState, formData: FormData) => Promise<OfferActionState>;

interface OfferInlineEditorProps {
  offer: {
    id: string;
    discountType: string;
    discountValue: number;
    isGlobal: boolean;
  };
  action: FormAction;
}

/**
 * An offer's discount settings — saved immediately. Its title and
 * description are edited in both languages on the offer's own page.
 */
export function OfferInlineEditor({ offer, action }: OfferInlineEditorProps) {
  const t = useT('adminContent');
  const tc = useT('common');
  const draftKey = `offer-settings:${offer.id}`;
  const formRef = usePreservedForm(draftKey);
  const [state, formAction, pending] = useActionState<OfferActionState, FormData>(action, {});

  useEffect(() => {
    if (state.success) clearDraft(draftKey);
  }, [state.success, draftKey]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={offer.id} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`offer-type-${offer.id}`} className="block text-xs font-medium text-zinc-500 mb-1">{t('promotions.discountType')}</label>
          <select
            id={`offer-type-${offer.id}`}
            name="discountType"
            defaultValue={offer.discountType}
            className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
          >
            <option value="PERCENTAGE">{t('promotions.types.PERCENTAGE')}</option>
            <option value="FIXED">{t('promotions.types.FIXED')}</option>
          </select>
        </div>
        <div>
          <label htmlFor={`offer-value-${offer.id}`} className="block text-xs font-medium text-zinc-500 mb-1">{t('promotions.discountValue')}</label>
          <input
            id={`offer-value-${offer.id}`}
            type="number"
            step="0.01"
            name="discountValue"
            required
            defaultValue={offer.discountValue}
            className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`isGlobal-${offer.id}`}
          name="isGlobal"
          defaultChecked={offer.isGlobal}
          className="w-4 h-4 text-zinc-900 border-zinc-300 rounded focus:ring-zinc-900"
        />
        <label htmlFor={`isGlobal-${offer.id}`} className="text-xs font-medium text-zinc-700">
          {t('offers.form.isGlobal')}
        </label>
      </div>

      {state.error && (
        <p className="text-xs text-red-600" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-xs text-emerald-600" role="status">✓ {t('offers.card.saved')}</p>}

      <div className="flex justify-start">
        <button
          type="submit"
          disabled={pending}
          className="text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-1.5 rounded transition-colors disabled:opacity-50"
        >
          {pending ? tc('actions.saving') : t('offers.card.saveSettings')}
        </button>
      </div>
    </form>
  );
}
