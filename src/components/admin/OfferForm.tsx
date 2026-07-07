'use client';

import { useActionState, useEffect, useRef } from 'react';
import { createOffer, type OfferActionState } from '@/app/actions/admin';

export function OfferForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<OfferActionState, FormData>(
    createOffer,
    {}
  );

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <div className="bg-white p-6 rounded-lg shadow border border-zinc-200 mb-8">
      <h3 className="text-lg font-bold mb-4">Create New Offer</h3>
      <form ref={formRef} action={formAction} className="space-y-4">
        {state.error && (
          <div
            className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm"
            role="alert"
          >
            {state.error}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Title</label>
            <input
              type="text"
              name="title"
              required
              placeholder="e.g. New Client Special"
              className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Description</label>
            <textarea
              name="description"
              required
              rows={3}
              placeholder="e.g. Get 20% off your first haircut with us!"
              className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Discount Type</label>
              <select
                name="discountType"
                className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
              >
                <option value="PERCENTAGE">Percentage (%)</option>
                <option value="FIXED">Fixed Amount (£)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Discount Value</label>
              <input
                type="number"
                step="0.01"
                name="discountValue"
                required
                placeholder="e.g. 20"
                className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isGlobal"
              name="isGlobal"
              className="w-4 h-4 text-zinc-900 border-zinc-300 rounded focus:ring-zinc-900"
            />
            <label htmlFor="isGlobal" className="text-sm font-medium text-zinc-700">
              Apply 10% Discount Badge to All Services
            </label>
          </div>
        </div>
        <div className="flex justify-end items-center gap-3">
          {state.success && <span className="text-xs text-emerald-600">✓ Created</span>}
          <button
            type="submit"
            disabled={pending}
            className="bg-zinc-900 text-white px-6 py-2 rounded-md hover:bg-zinc-800 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {pending ? 'Creating…' : 'Create Offer'}
          </button>
        </div>
      </form>
    </div>
  );
}
