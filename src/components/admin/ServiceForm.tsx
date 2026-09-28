'use client';

import Link from '@/i18n/link';
import { useActionState, useEffect } from 'react';
import type { ServiceActionState } from '@/app/actions/admin-services';
import { CalendarColorPicker } from './CalendarColorPicker';
import { BilingualContentEditor } from './BilingualContentEditor';
import { useT } from '@/i18n/client';
import { clearDraft, usePreservedForm } from '@/i18n/draft-store';
import { HAIR_LENGTHS, PRICE_NATURES, PRICE_TYPES, VAT_DISPLAYS } from '@/app/services/pricing/policy';

type FormAction = (prev: ServiceActionState, formData: FormData) => Promise<ServiceActionState>;

type ServiceLite = {
  id: string;
  duration: number;
  category: string;
  imageUrl: string | null;
  requiresPatchTest: boolean;
  isPatchTest: boolean;
  requiresConsultation: boolean;
  isConsultation: boolean;
  treatwellExternalId: string | null;
  calendarColor: string | null;
  offeringId: string | null;
  hairLength: string | null;
  priceType: string;
  vatDisplay: string;
  priceNature: string;
  isPublic: boolean;
  isBookable: boolean;
  durationConfirmed: boolean;
  /** Set for a composite option (e.g. extra long = long + surcharge): shown read-only. */
  composite?: { baseName: string; surcharge: string } | null;
};

interface ServiceFormProps {
  mode: 'create' | 'edit';
  action: FormAction;
  service?: ServiceLite;
  saved?: boolean;
  existingCategories: string[];
  offerings: { id: string; key: string; name: string }[];
}

const fieldClass = 'w-full border border-zinc-300 rounded px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent';
const labelClass = 'block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2';

/**
 * Service SETTINGS — the operational part of a service, saved immediately.
 * In edit mode the customer-facing text and price live in the separate
 * bilingual editor on the same page (draft → publish). In create mode the
 * bilingual editor is embedded here, because a new service needs its text in
 * both languages before it can exist.
 *
 * Unsaved edits survive an interface-language switch: the uncontrolled fields
 * are snapshotted in memory (usePreservedForm) and written back after the
 * page remounts in the other language.
 */
export function ServiceForm({ mode, action, service, saved, existingCategories, offerings }: ServiceFormProps) {
  const t = useT('adminCatalog');
  const tc = useT('common');
  const tp = useT('pricing');
  const draftKey = `service-form:${service?.id ?? 'new'}`;
  const formRef = usePreservedForm(draftKey);
  const [state, formAction, pending] = useActionState<ServiceActionState, FormData>(action, {
    status: 'idle',
  });

  // A saved form starts clean next time.
  useEffect(() => {
    if (state.status === 'success') clearDraft(draftKey);
  }, [state.status, draftKey]);

  const showSavedBanner = saved || state.status === 'success';

  return (
    <form ref={formRef} action={formAction} className="space-y-6">
      {mode === 'edit' && service && <input type="hidden" name="id" value={service.id} />}

      {showSavedBanner && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded text-sm" role="status">
          ✓ {t('serviceForm.saved')}
        </div>
      )}

      {state.status === 'error' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm" role="alert">
          {state.message}
        </div>
      )}

      {mode === 'create' && (
        <>
          <BilingualContentEditor mode="create" type="SERVICE" />
          <section className="bg-white border border-zinc-200 rounded-lg p-6">
            <label htmlFor="service-price" className={labelClass}>{t('serviceForm.price')} *</label>
            <input id="service-price" type="text" inputMode="decimal" name="price" required pattern="\d{1,6}(\.\d{1,2})?" placeholder="0.00" className={`${fieldClass} max-w-48 font-mono`} />
          </section>
        </>
      )}

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('serviceForm.settingsTitle')}</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{t('serviceForm.settingsHelp')}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          <div>
            <label htmlFor="service-duration" className={labelClass}>{t('serviceForm.duration')} *</label>
            {/* min must be a multiple of step: with min=1 the browser's valid
                values were 1, 6, 11 … 41, 46, so every real duration (15, 30,
                45, 60, 90) failed HTML5 validation and the form silently
                refused to submit. */}
            <input id="service-duration" type="number" name="duration" required min={5} max={1440} step={5} defaultValue={service?.duration} placeholder="30" className={`${fieldClass} font-mono`} />
          </div>
          <div>
            <label htmlFor="service-category" className={labelClass}>{t('serviceForm.category')} *</label>
            <input id="service-category" type="text" name="category" required list="category-suggestions" maxLength={100} defaultValue={service?.category} placeholder="Haircuts" className={fieldClass} />
            <datalist id="category-suggestions">
              {existingCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <p className="text-xs text-zinc-500 mt-1">{t('serviceForm.categoryHelp')}</p>
          </div>
          <div>
            <label className="flex items-center gap-3 cursor-pointer mt-7">
              <input type="checkbox" name="durationConfirmed" defaultChecked={service?.durationConfirmed ?? true} className="h-4 w-4 rounded border-zinc-300" />
              <span className="text-sm text-zinc-700">{t('serviceForm.durationConfirmed')}</span>
            </label>
          </div>
        </div>

        <fieldset className="grid md:grid-cols-3 gap-5">
          <legend className={labelClass}>{t('serviceForm.optionTitle')}</legend>
          <div>
            <label htmlFor="service-offering" className="block text-xs text-zinc-600 mb-1">{t('serviceForm.offering')}</label>
            <select id="service-offering" name="offeringId" defaultValue={service?.offeringId ?? ''} className={fieldClass}>
              <option value="">{t('serviceForm.noOffering')}</option>
              {offerings.map((offering) => <option key={offering.id} value={offering.id}>{offering.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="service-length" className="block text-xs text-zinc-600 mb-1">{t('serviceForm.hairLength')}</label>
            <select id="service-length" name="hairLength" defaultValue={service?.hairLength ?? ''} className={fieldClass}>
              <option value="">{t('serviceForm.noLength')}</option>
              {HAIR_LENGTHS.map((length) => <option key={length} value={length}>{tp.dynamic(`hairLength.${length}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="service-price-type" className="block text-xs text-zinc-600 mb-1">{t('serviceForm.priceType')}</label>
            <select id="service-price-type" name="priceType" defaultValue={service?.priceType ?? 'STANDARD'} className={fieldClass}>
              {PRICE_TYPES.map((type) => <option key={type} value={type}>{tp.dynamic(`priceType.${type}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="service-vat" className="block text-xs text-zinc-600 mb-1">{t('serviceForm.vatDisplay')}</label>
            <select id="service-vat" name="vatDisplay" defaultValue={service?.vatDisplay ?? 'UNSPECIFIED'} className={fieldClass}>
              {VAT_DISPLAYS.map((vat) => <option key={vat} value={vat}>{t.dynamic(`serviceForm.vat.${vat}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="service-nature" className="block text-xs text-zinc-600 mb-1">{t('serviceForm.priceNature')}</label>
            <select id="service-nature" name="priceNature" defaultValue={service?.priceNature ?? 'LISTED'} className={fieldClass}>
              {PRICE_NATURES.map((nature) => <option key={nature} value={nature}>{t.dynamic(`serviceForm.nature.${nature}`)}</option>)}
            </select>
          </div>
          {service?.composite && (
            <p className="md:col-span-3 text-xs text-zinc-600">{t('serviceForm.composite', { base: service.composite.baseName, surcharge: service.composite.surcharge })}</p>
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className={labelClass}>{t('serviceForm.availabilityTitle')}</legend>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" name="isPublic" defaultChecked={service?.isPublic ?? true} className="h-4 w-4 rounded border-zinc-300" />
            <span className="text-sm text-zinc-700">{t('serviceForm.isPublic')}</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" name="isBookable" defaultChecked={service?.isBookable ?? true} className="h-4 w-4 rounded border-zinc-300" />
            <span className="text-sm text-zinc-700">{t('serviceForm.isBookable')}</span>
          </label>
          <p className="text-xs text-zinc-500">{t('serviceForm.availabilityHelp')}</p>
        </fieldset>

        <div>
          <label htmlFor="service-image" className={labelClass}>
            {t('serviceForm.imageUrl')} <span className="text-zinc-400 normal-case tracking-normal">{t('serviceForm.optional')}</span>
          </label>
          <input id="service-image" type="text" name="imageUrl" maxLength={500} defaultValue={service?.imageUrl ?? ''} placeholder="/images/services-hero.webp or https://..." className={`${fieldClass} text-sm font-mono`} />
        </div>

        <div className="space-y-3 pt-2">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-600">{t('serviceForm.colourFlags')}</p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" name="requiresPatchTest" defaultChecked={service?.requiresPatchTest ?? false} className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900" />
            <span className="text-sm text-zinc-700">{t('serviceForm.requiresPatchTest')} <span className="text-zinc-400">{t('serviceForm.requiresPatchTestHelp')}</span></span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" name="isPatchTest" defaultChecked={service?.isPatchTest ?? false} className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900" />
            <span className="text-sm text-zinc-700">{t('serviceForm.isPatchTest')}</span>
          </label>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-600 pt-2">{t('serviceForm.consultationGate')}</p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" name="requiresConsultation" defaultChecked={service?.requiresConsultation ?? false} className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900" />
            <span className="text-sm text-zinc-700">{t('serviceForm.requiresConsultation')} <span className="text-zinc-400">{t('serviceForm.requiresConsultationHelp')}</span></span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" name="isConsultation" defaultChecked={service?.isConsultation ?? false} className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900" />
            <span className="text-sm text-zinc-700">{t('serviceForm.isConsultation')}</span>
          </label>
        </div>
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('serviceForm.scheduleBoard')}</h2>
        <CalendarColorPicker
          name="calendarColor"
          label={t('serviceForm.calendarColour')}
          initial={service?.calendarColor}
          help={t('serviceForm.calendarColourHelp')}
        />
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('serviceForm.integrations')}</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{t('serviceForm.integrationsHelp')}</p>
        </div>
        <div>
          <label htmlFor="service-treatwell" className={labelClass}>
            {t('serviceForm.treatwellId')} <span className="text-zinc-400 normal-case tracking-normal">{t('serviceForm.treatwellIdHint')}</span>
          </label>
          <input id="service-treatwell" type="text" name="treatwellExternalId" maxLength={200} defaultValue={service?.treatwellExternalId ?? ''} className={`${fieldClass} text-sm font-mono`} />
        </div>
      </section>

      <div className="flex items-center justify-between gap-4 bg-zinc-50 py-4 border-t border-zinc-200">
        <Link href="/admin/services" className="text-sm font-medium text-zinc-600 hover:text-zinc-900">
          ← {t('serviceForm.backToList')}
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="bg-zinc-900 hover:bg-zinc-800 text-white px-8 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? tc('actions.saving') : mode === 'create' ? t('serviceForm.create') : t('serviceForm.saveSettings')}
        </button>
      </div>
    </form>
  );
}
