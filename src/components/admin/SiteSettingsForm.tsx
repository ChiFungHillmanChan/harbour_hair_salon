'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from '@/i18n/link';
import {
  updateSiteSettings,
  type SettingsActionState,
} from '@/app/actions/admin-settings';
import type { EditableSiteSettings } from '@/app/services/site-settings-service';
import { penceToDecimalString } from '@/app/services/pricing/money';
import { HIGH_DEPOSIT_PERCENT, isHighDepositPercent } from '@/app/services/deposit-policy';
import { BOOKING_BETA_MAX_TESTERS, LATE_ARRIVAL_CANCEL_MINUTES } from '@/app/lib/booking-constants';
import { LOCALES } from '@/i18n/config';
import { useT } from '@/i18n/client';
import { rich } from '@/i18n/rich';
import { clearDraft, usePreservedForm } from '@/i18n/draft-store';

/**
 * Everything except the homepage hero text, which has its own bilingual editor.
 * `bookingBetaEmails` is the beta testers' list, one address per line.
 */
type OperationalSettings = Omit<EditableSiteSettings, 'heroEyebrow' | 'heroTitleLine1' | 'heroTitleLine2' | 'heroSubtitle'>;

interface SiteSettingsFormProps {
  settings: OperationalSettings;
  /** Production cannot open online booking without Square production credentials (lib/online-booking-lock.ts). */
  bookingLockedForPayments?: boolean;
}

const DRAFT_KEY = 'site-settings-form';
const fieldClass = 'min-h-11 min-w-0 w-full border border-zinc-300 rounded px-3 py-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent';
const labelClass = 'block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2';

/**
 * The salon's deposit percentage (0–100), with a standing reminder to keep it
 * proportionate and a warning above HIGH_DEPOSIT_PERCENT: UK consumer law can
 * treat a large deposit the salon keeps as unfair. It follows what is typed,
 * and a value the form restores after a language switch (`draft-restored`).
 */
export function DepositPercentField({ defaultValue }: { defaultValue: number }) {
  const t = useT('adminContent');
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(String(defaultValue));
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const sync = () => setValue(input.current?.value ?? '');
    form.addEventListener('draft-restored', sync);
    return () => form.removeEventListener('draft-restored', sync);
  }, []);
  const high = value.trim() !== '' && isHighDepositPercent(Number(value));
  return (
    <div>
      <label htmlFor="settings-deposit-percent" className={labelClass}>
        {t('settings.fields.depositPercent')}
      </label>
      <input
        ref={input}
        id="settings-deposit-percent"
        type="number"
        name="depositPercent"
        required
        min={0}
        max={100}
        step={1}
        inputMode="numeric"
        defaultValue={defaultValue}
        onChange={(event) => setValue(event.target.value)}
        aria-describedby={`settings-deposit-percent-help settings-deposit-percent-hint${high ? ' settings-deposit-percent-warning' : ''}`}
        className={`${fieldClass} font-mono`}
      />
      <p id="settings-deposit-percent-help" className="text-xs text-zinc-500 mt-1">{t('settings.deposits.percentHelp')}</p>
      <p id="settings-deposit-percent-hint" className="text-xs text-zinc-500 mt-1">{t('settings.deposits.proportionate')}</p>
      <div role="status">
        {high && (
          <p id="settings-deposit-percent-warning" className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            {t('settings.deposits.percentHigh', { percent: HIGH_DEPOSIT_PERCENT })}
          </p>
        )}
      </div>
    </div>
  );
}

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

      <section id="settings-booking" className="scroll-mt-20 bg-white border border-zinc-200 rounded-lg p-3 space-y-4 sm:p-6 sm:space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('settings.booking.title')}</h2>
          <p className="text-xs text-zinc-500 mt-1">{t('settings.booking.help')}</p>
        </div>

        <label className="flex min-h-11 items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="bookingEnabled"
            defaultChecked={settings.bookingEnabled && !bookingLockedForPayments}
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

        <div>
          <label htmlFor="settings-beta-emails" className={labelClass}>
            {t('settings.fields.bookingBetaEmails')}
          </label>
          <textarea
            id="settings-beta-emails"
            name="bookingBetaEmails"
            rows={4}
            maxLength={10_000}
            defaultValue={settings.bookingBetaEmails ?? ''}
            placeholder="tester@example.com"
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
            aria-describedby={`settings-beta-emails-help${bookingLockedForPayments ? ' settings-beta-emails-locked' : ''}`}
            className={`${fieldClass} font-mono`}
          />
          <p id="settings-beta-emails-help" className="text-xs text-zinc-500 mt-1">
            {t('settings.booking.betaHelp', { max: BOOKING_BETA_MAX_TESTERS })}
          </p>
          {bookingLockedForPayments && (
            <p id="settings-beta-emails-locked" className="mt-2 rounded border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-700" role="note">
              {t('settings.booking.betaPaymentsLocked')}
            </p>
          )}
        </div>
      </section>

      <section id="settings-deposits" className="scroll-mt-20 bg-white border border-zinc-200 rounded-lg p-3 space-y-4 sm:p-6 sm:space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('settings.deposits.title')}</h2>
          <p className="text-xs text-zinc-500 mt-1">{t('settings.deposits.help')}</p>
        </div>

        <label className="flex min-h-11 items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="depositsEnabled"
            defaultChecked={settings.depositsEnabled}
            className="mt-1 h-5 w-5 rounded border-zinc-300 text-zinc-900 focus:ring-2 focus:ring-zinc-900"
          />
          <span>
            <span className="block text-sm font-medium text-zinc-900">{t('settings.deposits.label')}</span>
            <span className="block text-xs text-zinc-500 mt-1">{t('settings.deposits.explain')}</span>
          </span>
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <DepositPercentField defaultValue={settings.depositPercent} />
          <div>
            <label htmlFor="settings-deposit-minimum" className={labelClass}>
              {t('settings.fields.depositMinimumServicePence')}
            </label>
            <input
              id="settings-deposit-minimum"
              type="text"
              inputMode="decimal"
              name="depositMinimumServicePounds"
              pattern="\d{1,6}(\.\d{1,2})?"
              placeholder="0.00"
              defaultValue={penceToDecimalString(settings.depositMinimumServicePence)}
              aria-describedby="settings-deposit-minimum-help"
              className={`${fieldClass} font-mono`}
            />
            <p id="settings-deposit-minimum-help" className="text-xs text-zinc-500 mt-1">{t('settings.deposits.minimumHelp')}</p>
          </div>
        </div>

        <p className="rounded border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs leading-5 text-zinc-700" role="note">
          {rich(t('settings.deposits.squareNote'), {
            strong: (text) => <strong>{text}</strong>,
          })}
        </p>
      </section>

      <section id="settings-lateArrivals" className="scroll-mt-20 bg-white border border-zinc-200 rounded-lg p-3 space-y-4 sm:p-6 sm:space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('settings.lateArrivals.title')}</h2>
          <p className="text-xs text-zinc-500 mt-1">{t('settings.lateArrivals.help', { minutes: LATE_ARRIVAL_CANCEL_MINUTES })}</p>
        </div>
        <label className="flex min-h-11 items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="lateAutoCancelEnabled"
            defaultChecked={Boolean(settings.lateAutoCancelSince)}
            className="mt-1 h-5 w-5 rounded border-zinc-300 text-zinc-900 focus:ring-2 focus:ring-zinc-900"
          />
          <span>
            <span className="block text-sm font-medium text-zinc-900">{t('settings.lateArrivals.label', { minutes: LATE_ARRIVAL_CANCEL_MINUTES })}</span>
            <span className="block text-xs text-zinc-500 mt-1">{t('settings.lateArrivals.explain')}</span>
          </span>
        </label>
      </section>

      <section id="settings-contact" className="scroll-mt-20 bg-white border border-zinc-200 rounded-lg p-3 space-y-4 sm:p-6 sm:space-y-5">
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

      <section id="settings-notifications" className="scroll-mt-20 bg-white border border-zinc-200 rounded-lg p-3 space-y-4 sm:p-6 sm:space-y-5">
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

      <section id="settings-social" className="scroll-mt-20 bg-white border border-zinc-200 rounded-lg p-3 space-y-4 sm:p-6 sm:space-y-5">
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

      <section id="settings-search" className="scroll-mt-20 bg-white border border-zinc-200 rounded-lg p-3 space-y-4 sm:p-6 sm:space-y-5">
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
          className="min-h-11 w-full sm:w-auto bg-zinc-900 hover:bg-zinc-800 text-white px-8 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? tc('actions.saving') : t('settings.save')}
        </button>
      </div>
    </form>
  );
}
