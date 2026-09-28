'use client';

import Link from '@/i18n/link';
import { useActionState, useEffect } from 'react';
import type { StylistActionState } from '@/app/actions/admin-stylists';
import { CalendarColorPicker } from './CalendarColorPicker';
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
}

const fieldClass = 'w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent';
const labelClass = 'block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2';

/**
 * Stylist SETTINGS — name, address, photo, experience, schedule colour and
 * integration ids — saved immediately. In edit mode the profile text is
 * edited in the separate bilingual editor on the same screen (draft →
 * publish); in create mode that editor is embedded here, because a new
 * profile needs its text in both languages first.
 */
export function StylistForm({ mode, action, stylist, saved, treatwellExternalId, calendarColor }: StylistFormProps) {
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
    <form ref={formRef} action={formAction} className="space-y-6 pb-16">
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

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('stylists.form.settingsTitle')}</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{t('stylists.form.settingsHelp')}</p>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
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
            placeholder="/images/stylists/chan.webp or https://..."
            className={`${fieldClass} font-mono`}
          />
        </div>
      </section>

      {mode === 'create' && <BilingualContentEditor mode="create" type="STYLIST" initial={{ 'en-GB': { languages: ['English'] } }} />}

      <section className="bg-white rounded-lg border border-zinc-200 p-6 space-y-4">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('stylists.form.scheduleBoard')}</h2>
        <CalendarColorPicker
          name="calendarColor"
          label={t('stylists.form.calendarColour')}
          initial={calendarColor}
          help={t('stylists.form.calendarColourHelp')}
        />
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
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

      <div className="flex items-center justify-between gap-4 sticky bottom-0 bg-zinc-50 py-4 border-t border-zinc-200">
        <Link href="/admin/stylists" className="text-sm font-medium text-zinc-600 hover:text-zinc-900">
          ← {t('stylists.form.backToList')}
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="bg-zinc-900 hover:bg-zinc-800 text-white px-8 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? tc('actions.saving') : mode === 'create' ? t('stylists.form.create') : t('stylists.form.saveSettings')}
        </button>
      </div>
    </form>
  );
}
