'use client';

import { useActionState } from 'react';
import {
  updateSiteSettings,
  type SettingsActionState,
} from '@/app/actions/admin-settings';
import type { SiteSettings } from '@/app/services/site-settings-service';

interface SiteSettingsFormProps {
  settings: SiteSettings;
}

export function SiteSettingsForm({ settings }: SiteSettingsFormProps) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    updateSiteSettings,
    { status: 'idle' }
  );

  return (
    <form action={formAction} className="space-y-6">
      {state.status === 'success' && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded text-sm">
          ✓ Settings saved.
        </div>
      )}
      {state.status === 'error' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm" role="alert">
          {state.message}
        </div>
      )}

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">Online booking</h2>
          <p className="text-xs text-zinc-500 mt-1">
            The master switch for booking on this website. Takes effect as soon as you save —
            no redeploy needed.
          </p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="bookingEnabled"
            defaultChecked={settings.bookingEnabled}
            className="mt-1 h-5 w-5 rounded border-zinc-300 text-zinc-900 focus:ring-2 focus:ring-zinc-900"
          />
          <span>
            <span className="block text-sm font-medium text-zinc-900">
              Accept bookings on the website
            </span>
            <span className="block text-xs text-zinc-500 mt-1">
              When off, <code className="text-[11px]">/book</code> shows the maintenance notice
              with your phone number and a Treatwell link, new bookings and reschedules are
              refused server-side, and the Reschedule button is disabled. Customers can still
              cancel existing appointments either way.
            </span>
          </span>
        </label>

        {!settings.bookingEnabled && (
          <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
            <strong>Booking is currently OFF.</strong> Before switching it on, check{' '}
            <a href="/admin/integrations" className="underline font-semibold">
              Integrations
            </a>{' '}
            — if Treatwell two-way calendar sync is not configured for every stylist, the same
            slot can be sold twice.
          </div>
        )}
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">Contact</h2>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Phone number *
          </label>
          <input
            type="text"
            name="phone"
            required
            maxLength={40}
            defaultValue={settings.phone}
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">Home hero</h2>
          <p className="text-xs text-zinc-500 mt-1">
            The copy shown over the homepage hero image.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Eyebrow text *
          </label>
          <input
            type="text"
            name="heroEyebrow"
            required
            maxLength={80}
            defaultValue={settings.heroEyebrow}
            placeholder="Leeds City Centre"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Title line 1 *
          </label>
          <input
            type="text"
            name="heroTitleLine1"
            required
            maxLength={60}
            defaultValue={settings.heroTitleLine1}
            placeholder="Expert Hair"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Title line 2 *
          </label>
          <input
            type="text"
            name="heroTitleLine2"
            required
            maxLength={60}
            defaultValue={settings.heroTitleLine2}
            placeholder="Styling"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Subtitle *
          </label>
          <textarea
            name="heroSubtitle"
            required
            rows={3}
            maxLength={400}
            defaultValue={settings.heroSubtitle}
            placeholder="Tailored cuts, colours and grooming by Hong Kong trained stylists. Precision and artistry in every appointment."
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">Social links</h2>
          <p className="text-xs text-zinc-500 mt-1">
            These feed into the HairSalon schema sameAs array. Add the ones you have; leave the rest blank.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Instagram URL
          </label>
          <input
            type="url"
            name="instagramUrl"
            maxLength={500}
            defaultValue={settings.instagramUrl}
            placeholder="https://www.instagram.com/harbourhair_leeds/"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Google Business Profile URL <span className="text-zinc-400 normal-case tracking-normal">(biggest local SEO lever)</span>
          </label>
          <input
            type="url"
            name="googleBusinessUrl"
            maxLength={500}
            defaultValue={settings.googleBusinessUrl}
            placeholder="https://maps.google.com/?cid=..."
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Facebook URL
          </label>
          <input
            type="url"
            name="facebookUrl"
            maxLength={500}
            defaultValue={settings.facebookUrl}
            placeholder="https://www.facebook.com/harbourhairleeds"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Treatwell URL
          </label>
          <input
            type="url"
            name="treatwellUrl"
            maxLength={500}
            defaultValue={settings.treatwellUrl}
            placeholder="https://www.treatwell.co.uk/place/..."
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Fresha URL
          </label>
          <input
            type="url"
            name="freshaUrl"
            maxLength={500}
            defaultValue={settings.freshaUrl}
            placeholder="https://www.fresha.com/..."
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Booksy URL
          </label>
          <input
            type="url"
            name="booksyUrl"
            maxLength={500}
            defaultValue={settings.booksyUrl}
            placeholder="https://booksy.com/..."
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">
            Search & social cards
          </h2>
          <p className="text-xs text-zinc-500 mt-1">
            Verification codes and handles for Twitter/X cards.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Twitter / X handle <span className="text-zinc-400 normal-case tracking-normal">(with or without @)</span>
          </label>
          <input
            type="text"
            name="twitterHandle"
            maxLength={40}
            defaultValue={settings.twitterHandle}
            placeholder="@harbourhair_leeds"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Google Search Console verification code
          </label>
          <input
            type="text"
            name="gscVerification"
            maxLength={200}
            defaultValue={settings.gscVerification}
            placeholder="google-site-verification=..."
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
          <p className="text-xs text-zinc-500 mt-1">
            Paste the content value from the meta tag (not the full HTML tag).
          </p>
        </div>
      </section>

      <div className="flex items-center justify-end bg-zinc-50 py-4 border-t border-zinc-200">
        <button
          type="submit"
          disabled={pending}
          className="bg-zinc-900 hover:bg-zinc-800 text-white px-8 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}
