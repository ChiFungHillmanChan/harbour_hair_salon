'use client';

import Link from '@/i18n/link';
import { useActionState, useEffect } from 'react';
import type { StylistActionState } from '@/app/actions/admin-stylists';
import { CalendarColorPicker } from './CalendarColorPicker';
import { GoogleColorPicker } from './GoogleColorPicker';
import { BilingualContentEditor } from './BilingualContentEditor';
import { useT } from '@/i18n/client';
import { rich } from '@/i18n/rich';
import { clearDraft, usePreservedForm } from '@/i18n/draft-store';

type FormAction = (prev: StylistActionState, formData: FormData) => Promise<StylistActionState>;

/** The operational part of a stylist; their profile text lives in the bilingual editor. */
type StylistSettings = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  yearsExperience: number | null;
};

interface StylistFormProps {
  mode: 'create' | 'edit';
  action: FormAction;
  stylist?: StylistSettings;
  saved?: boolean;
  /** Treatwell API staff/resource id; also kept out of public-facing types. */
  treatwellExternalId?: string | null;
  /** Admin schedule-board colour. Admin-only, so kept out of StylistRuntime too. */
  calendarColor?: string | null;
  /** Google Calendar event colour id ("1"–"11") this stylist's customers have in the salon diary. Admin-only. */
  googleColorId?: string | null;
  /** Other names the diary uses for this stylist, comma-separated. Admin-only. */
  googleAliases?: string | null;
  /** Counts as a chair for the diary's no-stylist (red) bookings; a new stylist does. */
  takesWalkIns?: boolean;
  /** Shown to customers (public Stylists pages, online booking); a new stylist is. */
  showOnWebsite?: boolean;
}

const fieldClass = 'min-w-0 w-full border border-zinc-300 rounded px-3 sm:px-4 py-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent';
const labelClass = 'block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2';

/**
 * Stylist SETTINGS — name, address, photo, experience, schedule colour and
 * integration ids — saved immediately. In edit mode the profile text is
 * edited in the separate bilingual editor on the same screen (draft →
 * publish); in create mode that editor is embedded here, because a new
 * profile needs its text in both languages first.
 */
export function StylistForm({ mode, action, stylist, saved, treatwellExternalId, calendarColor, googleColorId, googleAliases, takesWalkIns = true, showOnWebsite = true }: StylistFormProps) {
  const t = useT('adminContent');
  const tc = useT('common');
  const draftKey = `stylist-form:${stylist?.id ?? 'new'}`;
  const formRef = usePreservedForm(draftKey);
  const [state, formAction, pending] = useActionState<StylistActionState, FormData>(action, {
    status: 'idle',
  });

  useEffect(() => {
    if (state.status === 'success') clearDraft(draftKey);
  }, [state.status, draftKey]);

  const showSavedBanner = state.status === 'success' || (!!saved && state.status !== 'error');

  return (
    <form ref={formRef} action={formAction} className="min-w-0 space-y-4 sm:space-y-6 pb-16">
      {mode === 'edit' && stylist && <input type="hidden" name="id" value={stylist.id} />}

      {showSavedBanner && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded text-sm" role="status">
          ✓ {t('stylists.form.saved')}
        </div>
      )}
      {state.status === 'error' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm" role="alert">
          {state.message}
        </div>
      )}

      <section className="bg-white border border-zinc-200 rounded-lg p-3 sm:p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('stylists.form.settingsTitle')}</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{t('stylists.form.settingsHelp')}</p>
        </div>

        <div className="grid [&>*]:min-w-0 md:grid-cols-2 gap-5">
          <div>
            <label htmlFor="stylist-name" className={labelClass}>
              {t('stylists.form.name')} *
            </label>
            <input
              id="stylist-name"
              type="text"
              name="name"
              required
              minLength={2}
              maxLength={100}
              defaultValue={stylist?.name}
              className={`${fieldClass} text-base`}
            />
            <p className="text-xs text-zinc-500 mt-1">{t('stylists.form.nameHelp')}</p>
          </div>
          <div>
            <label htmlFor="stylist-years" className={labelClass}>
              {t('stylists.form.yearsExperience')}
            </label>
            <input
              id="stylist-years"
              type="number"
              name="yearsExperience"
              min={0}
              max={80}
              defaultValue={stylist?.yearsExperience ?? ''}
              className={fieldClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="stylist-slug" className={labelClass}>
            {t('stylists.form.slug')}
          </label>
          <input
            id="stylist-slug"
            type="text"
            name="slug"
            maxLength={80}
            defaultValue={stylist?.slug}
            placeholder={t('stylists.form.slugPlaceholder')}
            className={`${fieldClass} font-mono`}
          />
        </div>

        <div>
          <label htmlFor="stylist-image" className={labelClass}>
            {t('stylists.form.imageUrl')}
          </label>
          <input
            id="stylist-image"
            type="text"
            name="imageUrl"
            maxLength={500}
            defaultValue={stylist?.imageUrl ?? ''}
            placeholder={t('stylists.form.imageUrlPlaceholder')}
            className={`${fieldClass} font-mono`}
          />
        </div>
      </section>

      {mode === 'create' && <BilingualContentEditor mode="create" type="STYLIST" initial={{ 'en-GB': { languages: ['English'] } }} />}

      <section className="bg-white rounded-lg border border-zinc-200 p-3 sm:p-6 space-y-4">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('stylists.form.scheduleBoard')}</h2>
        <CalendarColorPicker
          name="calendarColor"
          label={t('stylists.form.calendarColour')}
          initial={calendarColor}
          help={t('stylists.form.calendarColourHelp')}
        />
      </section>

      <section className="bg-white rounded-lg border border-zinc-200 p-3 sm:p-6 space-y-4">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('stylists.form.googleDiary')}</h2>
        <GoogleColorPicker name="googleColorId" label={t('stylists.form.googleColour')} initial={googleColorId ?? null} help={t('stylists.form.googleColourHelp')} allowNone />
        <div>
          <label htmlFor="stylist-google-names" className={labelClass}>{t('stylists.form.googleNames')}</label>
          <input id="stylist-google-names" type="text" name="googleAliases" maxLength={200} defaultValue={googleAliases ?? ''} className={fieldClass} />
          <p className="text-xs text-zinc-500 mt-1">{t('stylists.form.googleNamesHelp')}</p>
        </div>
      </section>

      <section className="bg-white rounded-lg border border-zinc-200 p-3 sm:p-6 space-y-4">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('stylists.form.websiteAndBooking')}</h2>
        <div>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-zinc-900">
            <input type="checkbox" name="showOnWebsite" defaultChecked={showOnWebsite} className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
            {t('stylists.form.showOnWebsite')}
          </label>
          <p className="text-xs text-zinc-500 mt-1">{t('stylists.form.showOnWebsiteHelp')}</p>
        </div>
        <div>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-zinc-900">
            <input type="checkbox" name="takesWalkIns" defaultChecked={takesWalkIns} className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
            {t('stylists.form.takesWalkIns')}
          </label>
          <p className="text-xs text-zinc-500 mt-1">{t('stylists.form.takesWalkInsHelp')}</p>
        </div>
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-3 sm:p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('stylists.form.integrations')}</h2>
        <p className="text-sm text-zinc-600">
          {rich(t('stylists.form.integrationsIntro'), {
            link: (text) => (
              <Link href="/admin/integrations" className="underline font-medium text-zinc-900">
                {text}
              </Link>
            ),
          })}
        </p>
        <div>
          <label htmlFor="stylist-treatwell" className={labelClass}>
            {t('stylists.form.treatwellId')} <span className="text-zinc-400 normal-case tracking-normal">{t('stylists.form.treatwellIdHint')}</span>
          </label>
          <input
            id="stylist-treatwell"
            type="text"
            name="treatwellExternalId"
            maxLength={200}
            defaultValue={treatwellExternalId ?? ''}
            placeholder={t('stylists.form.treatwellIdPlaceholder')}
            className={`${fieldClass} font-mono`}
          />
          <p className="text-xs text-zinc-500 mt-1">{t('stylists.form.treatwellIdHelp')}</p>
        </div>
      </section>

      <div className="flex flex-col-reverse items-stretch justify-between gap-2 sm:flex-row sm:items-center sm:gap-4 sticky bottom-0 bg-zinc-50 py-4 border-t border-zinc-200">
        <Link href="/admin/stylists" className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-zinc-600 hover:text-zinc-900 sm:justify-start">
          ← {t('stylists.form.backToList')}
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 bg-zinc-900 hover:bg-zinc-800 text-white px-4 sm:px-8 py-3 text-sm sm:uppercase sm:tracking-[0.15em] font-bold transition-colors rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? tc('actions.saving') : mode === 'create' ? t('stylists.form.create') : t('stylists.form.saveSettings')}
        </button>
      </div>
    </form>
  );
}
