'use client';

import { useActionState, useEffect } from 'react';
import Link from '@/i18n/link';
import {
  updateSiteSettings,
  type SettingsActionState,
} from '@/app/actions/admin-settings';
import type { SiteSettings } from '@/app/services/site-settings-service';
import { LOCALES } from '@/i18n/config';
import { useT } from '@/i18n/client';
import { rich } from '@/i18n/rich';
import { clearDraft, usePreservedForm } from '@/i18n/draft-store';

/** Everything except the homepage hero text, which has its own bilingual editor. */
type OperationalSettings = Omit<SiteSettings, 'heroEyebrow' | 'heroTitleLine1' | 'heroTitleLine2' | 'heroSubtitle'>;

interface SiteSettingsFormProps {
  settings: OperationalSettings;
  /** Production cannot open online booking before Square deposits are wired (lib/online-booking-lock.ts). */
  bookingLockedForPayments?: boolean;
}

const DRAFT_KEY = 'site-settings-form';
const fieldClass = 'w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent';
const labelClass = 'block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2';

export function SiteSettingsForm({ settings, bookingLockedForPayments = false }: SiteSettingsFormProps) {
  const t = useT('adminContent');
  const tc = useT('common');
  const formRef = usePreservedForm(DRAFT_KEY);
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    updateSiteSettings,
    { status: 'idle' }
  );

  useEffect(() => {
    if (state.status === 'success') clearDraft(DRAFT_KEY);
  }, [state.status]);

  const urlField = (name: 'instagramUrl' | 'googleBusinessUrl' | 'facebookUrl' | 'treatwellUrl' | 'freshaUrl' | 'booksyUrl', placeholder: string, hint?: string) => (
    <div>
      <label htmlFor={`settings-${name}`} className={labelClass}>
        {t.dynamic(`settings.fields.${name}`)}
        {hint && <> <span className="text-zinc-400 normal-case tracking-normal">{hint}</span></>}
      </label>
      <input
        id={`settings-${name}`}
        type="url"
        name={name}
        maxLength={500}
        defaultValue={settings[name]}
        placeholder={placeholder}
        className={`${fieldClass} font-mono`}
      />
    </div>
  );

  return (
    <form ref={formRef} action={formAction} className="space-y-6">
      {state.status === 'success' && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded text-sm" role="status">
          ✓ {t('settings.saved')}
        </div>
      )}
      {state.status === 'error' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm" role="alert">
          {state.message}
        </div>
      )}

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('settings.booking.title')}</h2>
          <p className="text-xs text-zinc-500 mt-1">{t('settings.booking.help')}</p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="bookingEnabled"
            defaultChecked={settings.bookingEnabled}
            disabled={bookingLockedForPayments}
            className="mt-1 h-5 w-5 rounded border-zinc-300 text-zinc-900 focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
          />
          <span>
            <span className="block text-sm font-medium text-zinc-900">
              {t('settings.booking.label')}
            </span>
            <span className="block text-xs text-zinc-500 mt-1">
              {rich(t('settings.booking.explain'), {
                code: (text) => <code className="text-[11px]">{text}</code>,
              })}
            </span>
          </span>
        </label>

        {bookingLockedForPayments ? (
          <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900" role="note">
            {rich(t('settings.booking.paymentsLocked'), {
              strong: (text) => <strong>{text}</strong>,
            })}
          </div>
        ) : !settings.bookingEnabled && (
          <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
            {rich(t('settings.booking.offWarning'), {
              strong: (text) => <strong>{text}</strong>,
              hours: (text) => (
                <Link href="/admin/opening-hours" className="underline font-semibold">
                  {text}
                </Link>
              ),
              integrations: (text) => (
                <Link href="/admin/integrations" className="underline font-semibold">
                  {text}
                </Link>
              ),
            })}
          </div>
        )}
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('settings.contact.title')}</h2>

        <div>
          <label htmlFor="settings-phone" className={labelClass}>
            {t('settings.fields.phone')} *
          </label>
          <input
            id="settings-phone"
            type="text"
            name="phone"
            required
            maxLength={40}
            defaultValue={settings.phone}
            className={fieldClass}
          />
        </div>
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('settings.notifications.title')}</h2>
          <p className="text-xs text-zinc-500 mt-1">{t('settings.notifications.help')}</p>
        </div>

        <div>
          <label htmlFor="settings-salon-locale" className={labelClass}>
            {t('settings.fields.salonNotificationLocale')}
          </label>
          <select
            id="settings-salon-locale"
            name="salonNotificationLocale"
            defaultValue={settings.salonNotificationLocale}
            className={`${fieldClass} md:max-w-sm`}
          >
            {LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {t.dynamic(`settings.notifications.options.${locale}`)}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('settings.social.title')}</h2>
          <p className="text-xs text-zinc-500 mt-1">{t('settings.social.help')}</p>
        </div>

        {urlField('instagramUrl', 'https://www.instagram.com/harbourhair_leeds/')}
        {urlField('googleBusinessUrl', 'https://maps.google.com/?cid=...', t('settings.social.googleHint'))}
        {urlField('facebookUrl', 'https://www.facebook.com/harbourhairleeds')}
        {urlField('treatwellUrl', 'https://www.treatwell.co.uk/place/...')}
        {urlField('freshaUrl', 'https://www.fresha.com/...')}
        {urlField('booksyUrl', 'https://booksy.com/...')}
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">
            {t('settings.search.title')}
          </h2>
          <p className="text-xs text-zinc-500 mt-1">{t('settings.search.help')}</p>
        </div>

        <div>
          <label htmlFor="settings-twitter" className={labelClass}>
            {t('settings.fields.twitterHandle')} <span className="text-zinc-400 normal-case tracking-normal">{t('settings.search.twitterHint')}</span>
          </label>
          <input
            id="settings-twitter"
            type="text"
            name="twitterHandle"
            maxLength={40}
            defaultValue={settings.twitterHandle}
            placeholder="@harbourhair_leeds"
            className={`${fieldClass} font-mono`}
          />
        </div>

        <div>
          <label htmlFor="settings-gsc" className={labelClass}>
            {t('settings.fields.gscVerification')}
          </label>
          <input
            id="settings-gsc"
            type="text"
            name="gscVerification"
            maxLength={200}
            defaultValue={settings.gscVerification}
            placeholder="google-site-verification=..."
            className={`${fieldClass} font-mono`}
          />
          <p className="text-xs text-zinc-500 mt-1">{t('settings.search.gscHelp')}</p>
        </div>
      </section>

      <div className="flex items-center justify-end bg-zinc-50 py-4 border-t border-zinc-200">
        <button
          type="submit"
          disabled={pending}
          className="bg-zinc-900 hover:bg-zinc-800 text-white px-8 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? tc('actions.saving') : t('settings.save')}
        </button>
      </div>
    </form>
  );
}
