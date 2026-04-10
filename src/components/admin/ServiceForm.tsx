'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { ServiceActionState } from '@/app/actions/admin-services';

type FormAction = (prev: ServiceActionState, formData: FormData) => Promise<ServiceActionState>;

type ServiceLite = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration: number;
  category: string;
  imageUrl: string | null;
};

interface ServiceFormProps {
  mode: 'create' | 'edit';
  action: FormAction;
  service?: ServiceLite;
  saved?: boolean;
  existingCategories: string[];
}

export function ServiceForm({ mode, action, service, saved, existingCategories }: ServiceFormProps) {
  const [state, formAction, pending] = useActionState<ServiceActionState, FormData>(action, {
    status: 'idle',
  });

  const showSavedBanner = saved || state.status === 'success';

  return (
    <form action={formAction} className="space-y-6">
      {mode === 'edit' && service && <input type="hidden" name="id" value={service.id} />}

      {showSavedBanner && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded text-sm">
          ✓ Saved successfully.
        </div>
      )}

      {state.status === 'error' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm" role="alert">
          {state.message}
        </div>
      )}

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Service name *
          </label>
          <input
            type="text"
            name="name"
            required
            minLength={2}
            maxLength={200}
            defaultValue={service?.name}
            placeholder="e.g. Short Over Ears - Wash, Haircut & Blow Dry"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Description <span className="text-zinc-400 normal-case tracking-normal">(optional — shown on service pages)</span>
          </label>
          <textarea
            name="description"
            rows={3}
            maxLength={500}
            defaultValue={service?.description ?? ''}
            placeholder="Brief description of what's included."
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
              Price (£) *
            </label>
            <input
              type="number"
              name="price"
              required
              min={0}
              step="0.01"
              defaultValue={service?.price}
              placeholder="0.00"
              className="w-full border border-zinc-300 rounded px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
              Duration (min) *
            </label>
            <input
              type="number"
              name="duration"
              required
              min={1}
              max={1440}
              step={5}
              defaultValue={service?.duration}
              placeholder="30"
              className="w-full border border-zinc-300 rounded px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
              Category *
            </label>
            <input
              type="text"
              name="category"
              required
              list="category-suggestions"
              maxLength={100}
              defaultValue={service?.category}
              placeholder="e.g. Haircuts"
              className="w-full border border-zinc-300 rounded px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
            <datalist id="category-suggestions">
              {existingCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <p className="text-xs text-zinc-500 mt-1">
              Must match an existing category exactly to appear on the matching detail page.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Image URL <span className="text-zinc-400 normal-case tracking-normal">(optional)</span>
          </label>
          <input
            type="text"
            name="imageUrl"
            maxLength={500}
            defaultValue={service?.imageUrl ?? ''}
            placeholder="/images/services-hero.webp or https://..."
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>
      </section>

      <div className="flex items-center justify-between gap-4 bg-zinc-50 py-4 border-t border-zinc-200">
        <Link href="/admin/services" className="text-sm font-medium text-zinc-600 hover:text-zinc-900">
          ← Back to list
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="bg-zinc-900 hover:bg-zinc-800 text-white px-8 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Saving…' : mode === 'create' ? 'Create service' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
