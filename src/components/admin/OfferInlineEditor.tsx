'use client';

import { useActionState } from 'react';
import type { OfferActionState } from '@/app/actions/admin';

type FormAction = (prev: OfferActionState, formData: FormData) => Promise<OfferActionState>;

interface OfferInlineEditorProps {
  offer: {
    id: string;
    title: string;
    description: string | null;
    discountType: string;
    discountValue: number;
    isGlobal: boolean;
  };
  action: FormAction;
}

export function OfferInlineEditor({ offer, action }: OfferInlineEditorProps) {
  const [state, formAction, pending] = useActionState<OfferActionState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={offer.id} />

      <div>
        <label className="block text-xs font-medium text-zinc-500 mb-1">Title</label>
        <input
          type="text"
          name="title"
          required
          defaultValue={offer.title}
          placeholder="Title"
          className="w-full border border-zinc-300 rounded px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-zinc-900"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-500 mb-1">Description</label>
        <textarea
          name="description"
          rows={2}
          defaultValue={offer.description ?? ''}
          placeholder="Description"
          className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">Discount Type</label>
          <select
            name="discountType"
            defaultValue={offer.discountType}
            className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
          >
            <option value="PERCENTAGE">Percentage (%)</option>
            <option value="FIXED">Fixed Amount (£)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">Discount Value</label>
          <input
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
          Apply discount badge to all services
        </label>
      </div>

      {state.error && (
        <p className="text-xs text-red-600" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-xs text-emerald-600">✓ Saved</p>}

      <div className="flex justify-start">
        <button
          type="submit"
          disabled={pending}
          className="text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-1.5 rounded transition-colors disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
