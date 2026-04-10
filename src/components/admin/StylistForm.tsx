'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import type { StylistActionState } from '@/app/actions/admin-stylists';
import type { StylistRuntime } from '@/app/stylists/slug';

type FormAction = (prev: StylistActionState, formData: FormData) => Promise<StylistActionState>;

interface StylistFormProps {
  mode: 'create' | 'edit';
  action: FormAction;
  stylist?: StylistRuntime;
  saved?: boolean;
}

function TextareaList({
  label,
  name,
  initial,
  placeholder,
  help,
}: {
  label: string;
  name: string;
  initial: string[];
  placeholder: string;
  help?: string;
}) {
  const [text, setText] = useState(initial.join('\n'));
  const parsed = text.split('\n').map((l) => l.trim()).filter(Boolean);

  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
        {label} <span className="text-zinc-400 normal-case tracking-normal">(one per line)</span>
      </label>
      <input type="hidden" name={name} value={JSON.stringify(parsed)} />
      <textarea
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
      />
      {help && <p className="text-xs text-zinc-500 mt-1">{help}</p>}
      <p className="text-xs text-zinc-400 mt-1">{parsed.length} entries</p>
    </div>
  );
}

export function StylistForm({ mode, action, stylist, saved }: StylistFormProps) {
  const [state, formAction, pending] = useActionState<StylistActionState, FormData>(action, {
    status: 'idle',
  });

  const showSavedBanner = saved || state.status === 'success';

  return (
    <form action={formAction} className="space-y-6 pb-16">
      {mode === 'edit' && stylist && <input type="hidden" name="id" value={stylist.id} />}

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
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">Identity</h2>

        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
              Name *
            </label>
            <input
              type="text"
              name="name"
              required
              minLength={2}
              maxLength={100}
              defaultValue={stylist?.name}
              className="w-full border border-zinc-300 rounded px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
              Role *
            </label>
            <input
              type="text"
              name="role"
              required
              maxLength={100}
              defaultValue={stylist?.role}
              placeholder="e.g. Lead Stylist"
              className="w-full border border-zinc-300 rounded px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Slug
          </label>
          <input
            type="text"
            name="slug"
            maxLength={80}
            defaultValue={stylist?.slug}
            placeholder="Leave blank to auto-generate from name"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Image URL
          </label>
          <input
            type="text"
            name="imageUrl"
            maxLength={500}
            defaultValue={stylist?.imageUrl ?? ''}
            placeholder="/images/stylists/chan.webp or https://..."
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Short bio <span className="text-zinc-400 normal-case tracking-normal">(shown on home showcase)</span>
          </label>
          <textarea
            name="bio"
            rows={3}
            maxLength={500}
            defaultValue={stylist?.bio ?? ''}
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Tagline <span className="text-zinc-400 normal-case tracking-normal">(optional, shown on profile page)</span>
          </label>
          <input
            type="text"
            name="tagline"
            maxLength={200}
            defaultValue={stylist?.tagline ?? ''}
            placeholder="e.g. Precision cutting and grooming, Hong Kong style."
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">Credentials</h2>

        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
              Years of experience
            </label>
            <input
              type="number"
              name="yearsExperience"
              min={0}
              max={80}
              defaultValue={stylist?.yearsExperience ?? ''}
              className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
              Trained in
            </label>
            <input
              type="text"
              name="trainedIn"
              maxLength={100}
              defaultValue={stylist?.trainedIn ?? ''}
              placeholder="e.g. Hong Kong"
              className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>
        </div>

        <TextareaList
          label="Specialties"
          name="specialtiesJson"
          initial={stylist?.specialties ?? []}
          placeholder="Men's precision haircuts&#10;Colour correction&#10;..."
        />

        <TextareaList
          label="Languages"
          name="languagesJson"
          initial={stylist?.languages ?? ['English']}
          placeholder="English&#10;Cantonese&#10;..."
        />
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">Profile page body</h2>
        <TextareaList
          label="Extended biography paragraphs"
          name="extendedBioJson"
          initial={stylist?.extendedBio ?? []}
          placeholder="One paragraph per line. Leave blank to fall back to short bio."
          help="Shown on the stylist detail page. Leave blank to hide the About section."
        />
      </section>

      <div className="flex items-center justify-between gap-4 sticky bottom-0 bg-zinc-50 py-4 border-t border-zinc-200">
        <Link href="/admin/stylists" className="text-sm font-medium text-zinc-600 hover:text-zinc-900">
          ← Back to list
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="bg-zinc-900 hover:bg-zinc-800 text-white px-8 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Saving…' : mode === 'create' ? 'Create stylist' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
