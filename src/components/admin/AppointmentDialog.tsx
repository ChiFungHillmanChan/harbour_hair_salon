'use client';

import { useEffect, useRef, useState } from 'react';
import { createAppointmentByAdmin, editAppointmentByAdmin, searchAdminCustomers, type AdminCustomerMatch, type AdminQuote } from '@/app/actions/admin-schedule';
import type { MoveClash } from '@/app/services/admin-move-clashes';
import { describeClash } from '@/app/lib/describe-clash';
import { describeBoardPrice, type BoardPrice } from '@/app/lib/board-price';
import { MIN_DURATION_MINUTES } from '@/app/lib/calendar-geometry';
import { formatGBP } from '@/app/services/pricing/money';
import { useLocale, useT } from '@/i18n/client';
import { DEFAULT_LOCALE, HTML_LANG, LOCALE_LABEL, LOCALES, isLocale, type Locale } from '@/i18n/config';
import { clearDraft, useDraftState } from '@/i18n/draft-store';

/** One row of the dialog's service menu (see admin-calendar-data). */
export type DialogService = {
  id: string;
  name: string;
  duration: number;
  category: string;
  requiresPatchTest: boolean;
  amountPence: number;
  priceVersion: number;
  priceType: string;
  hairLength: string | null;
  vatDisplay: string;
  priceNature: string;
  /** False for retired/unverified options: never offered for a new booking or a service change. */
  isBookable: boolean;
  offeringId: string | null;
};

export type DialogStylist = { id: string; name: string };

/** What the board hands the dialog: either a blank slot, or a booking to edit. */
export type DialogTarget =
  | { mode: 'create'; dateStr: string; time: string; stylistId?: string }
  | {
      mode: 'edit';
      appointmentId: string;
      dateStr: string;
      time: string;
      stylistId: string;
      serviceId: string;
      durationMin: number;
      notes: string;
      customerName: string;
      status: string;
      updatedAt: string;
      /** The price recorded on the appointment — never re-derived from today's list. */
      price: BoardPrice;
    };

/**
 * Every field an admin can type, kept in one draft so an interface-language
 * switch mid-edit (which remounts the page) hands it back intact.
 */
type DialogForm = {
  serviceId: string;
  stylistId: string;
  dateStr: string;
  time: string;
  durationMin: number;
  notes: string;
  status: 'CONFIRMED' | 'PENDING';
  notifyCustomer: boolean;
  customerQuery: string;
  picked: AdminCustomerMatch | null;
  name: string;
  email: string;
  phone: string;
  customerLocale: Locale;
  /** A newer price the server reported for the chosen service; saving again confirms it. */
  priceChange: AdminQuote | null;
};

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900';
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-zinc-600 mb-1';

/** Round up to the next quarter hour, the grain the whole board snaps to. */
function nextQuarterHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const rounded = Math.ceil((h * 60 + m) / MIN_DURATION_MINUTES) * MIN_DURATION_MINUTES;
  const capped = Math.min(rounded, 23 * 60 + 45);
  return `${String(Math.floor(capped / 60)).padStart(2, '0')}:${String(capped % 60).padStart(2, '0')}`;
}

export function AppointmentDialog({
  target,
  services,
  stylists,
  onClose,
  onSaved,
}: {
  target: DialogTarget;
  services: DialogService[];
  stylists: DialogStylist[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT('adminSchedule');
  const tp = useT('pricing');
  const locale = useLocale();
  const isEdit = target.mode === 'edit';
  // New bookings and service changes may only use options open to new bookings.
  // An appointment already on a retired option keeps showing it.
  const bookable = services.filter((service) => service.isBookable);
  const offered = services.filter((service) => service.isBookable || (isEdit && service.id === target.serviceId));

  const draftKey = `schedule-dialog:${isEdit ? target.appointmentId : 'new'}`;
  const [form, setForm] = useDraftState<DialogForm>(draftKey, () => ({
    serviceId: isEdit ? target.serviceId : bookable[0]?.id ?? '',
    stylistId: target.stylistId ?? stylists[0]?.id ?? '',
    dateStr: target.dateStr,
    time: isEdit ? target.time : nextQuarterHour(target.time),
    durationMin: isEdit ? target.durationMin : bookable[0]?.duration ?? 30,
    notes: isEdit ? target.notes : '',
    status: 'CONFIRMED',
    notifyCustomer: true,
    customerQuery: '',
    picked: null,
    name: '',
    email: '',
    phone: '',
    customerLocale: DEFAULT_LOCALE,
    priceChange: null,
  }));
  const update = (patch: Partial<DialogForm>) => setForm((previous) => ({ ...previous, ...patch }));
  const { serviceId, stylistId, dateStr, time, durationMin, notes, status, notifyCustomer, customerQuery, picked, name, email, phone, customerLocale, priceChange } = form;

  // Results carry the query they answered, so a slow reply for an abandoned
  // query is never rendered under a newer one.
  const [results, setResults] = useState<{ query: string; rows: AdminCustomerMatch[] }>({ query: '', rows: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<MoveClash[] | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const selectedService = services.find((s) => s.id === serviceId) ?? null;
  // Creating always prices the chosen option; editing only when the service changes.
  const pricing = !isEdit || serviceId !== target.serviceId;
  const pendingChange = pricing && priceChange?.serviceId === serviceId ? priceChange : null;

  // A closed or saved dialog must not come back pre-filled on the next open.
  const close = () => { clearDraft(draftKey); onClose(); };
  const saved = () => { clearDraft(draftKey); onSaved(); };
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const needle = customerQuery.trim();
  const searchable = !isEdit && !picked && needle.length >= 2;
  const matches = results.query === needle ? results.rows : [];

  // Debounced so a name typed at speed costs one lookup, not one per keystroke —
  // this reads the customer table on every call (see searchAdminCustomers).
  useEffect(() => {
    if (!searchable) return;
    let live = true;
    const id = setTimeout(async () => {
      const rows = await searchAdminCustomers(needle);
      if (live) setResults({ query: needle, rows });
    }, 300);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [needle, searchable]);

  const chooseService = (id: string) => {
    // Track the menu's duration until the admin overrides it by hand; a
    // 45-minute slot left over from the previous choice is never what they want.
    // A price confirmation belongs to the service it was shown for.
    const next = services.find((s) => s.id === id);
    update({ serviceId: id, priceChange: null, ...(next ? { durationMin: next.duration } : {}) });
  };

  /** The price the admin is looking at right now, sent back so the server can refuse a stale one. */
  const expectedQuote = () => {
    if (!pricing || !selectedService) return undefined;
    const shown = pendingChange ?? selectedService;
    return { serviceId, priceVersion: shown.priceVersion, amountPence: shown.amountPence };
  };

  const submit = async (overrideClashes: boolean) => {
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        const result = await editAppointmentByAdmin({
          appointmentId: target.appointmentId,
          dateStr,
          time,
          durationMin,
          stylistId,
          serviceId,
          notes,
          overrideClashes,
          expectedUpdatedAt: target.updatedAt,
          expectedQuote: expectedQuote(),
        });
        if (result.success) return saved();
        if ('clashes' in result) return setClashes(result.clashes);
        // The price moved while the dialog was open: show it and wait for an
        // explicit confirmation. Never retried automatically.
        if (result.quote) return update({ priceChange: result.quote });
        return setError(result.error);
      }

      const customer = picked
        ? ({ kind: 'existing', userId: picked.id } as const)
        : ({ kind: 'new', name: name.trim() || customerQuery.trim(), email, phone } as const);
      if (customer.kind === 'new' && !customer.name) {
        return setError(t('dialog.nameRequired'));
      }

      const result = await createAppointmentByAdmin({
        customer,
        serviceId,
        stylistId,
        dateStr,
        time,
        durationMin,
        status,
        notes,
        notifyCustomer,
        overrideClashes,
        expectedQuote: expectedQuote(),
        ...(customer.kind === 'new' ? { customerLocale } : {}),
      });
      if (result.success) return saved();
      if ('clashes' in result) return setClashes(result.clashes);
      if (result.quote) return update({ priceChange: result.quote });
      return setError(result.error);
    } finally {
      setSaving(false);
    }
  };

  const cancelBooking = async () => {
    if (target.mode !== 'edit' || saving) return;
    if (!window.confirm(t('dialog.cancelConfirm', { customer: target.customerName }))) return;
    setSaving(true);
    setError(null);
    try {
      const { updateAppointmentStatus } = await import('@/app/actions/admin');
      const result = await updateAppointmentStatus(target.appointmentId, 'CANCELLED');
      if (result.success) return saved();
      setError(result.error ?? t('dialog.cancelFailed'));
    } catch {
      setError(t('dialog.cancelUnknown'));
    } finally {
      setSaving(false);
    }
  };

  const formatPrice = (pence: number) => formatGBP(pence, HTML_LANG[locale]);
  const optionLabel = (service: DialogService) => {
    // Length and NHS come from the option's stable fields, not its name, so
    // the menu reads the same in either language.
    const tags = [
      service.hairLength ? tp.dynamic(`hairLength.${service.hairLength}`, undefined, '') : '',
      service.priceType === 'NHS' ? tp('priceType.NHS') : '',
    ].filter(Boolean);
    const label = t('dialog.option', {
      label: [service.name, ...tags].join(' · '),
      duration: tp('minutes', { count: service.duration }),
      price: formatPrice(service.amountPence),
    });
    return service.isBookable ? label : t('dialog.retiredOption', { label });
  };
  const categories = [...new Set(offered.map((service) => service.category))];

  // What the price panel shows: the recorded price while the service is
  // unchanged, otherwise the listed price of the chosen option (or the newer
  // one the server reported).
  const shownPrice: BoardPrice | null = !pricing
    ? (target.mode === 'edit' ? target.price : null)
    : pendingChange
      ? { known: true, amountPence: pendingChange.amountPence, priceType: pendingChange.priceType, vatDisplay: pendingChange.vatDisplay, priceNature: pendingChange.priceNature }
      : selectedService
        ? { known: true, amountPence: selectedService.amountPence, priceType: selectedService.priceType, vatDisplay: selectedService.vatDisplay, priceNature: selectedService.priceNature }
        : null;
  const priceText = shownPrice ? describeBoardPrice(shownPrice, tp) : null;
  const priceHeading = !pricing ? t('dialog.price.recorded') : isEdit ? t('dialog.price.changeNew') : t('dialog.price.new');
  const priceHelp = !pricing
    ? (shownPrice && !shownPrice.known ? t('dialog.price.unknownHelp') : null)
    : isEdit ? t('dialog.price.changeHelp') : null;

  const title = isEdit ? t('dialog.editTitle') : t('dialog.newTitle');
  const submitLabel = saving
    ? t('dialog.saving')
    : pendingChange
      ? (isEdit ? t('dialog.price.confirmSave') : t('dialog.price.confirmCreate'))
      : isEdit ? t('dialog.save') : t('dialog.create');

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-zinc-900/50 p-0 sm:p-4"
      onClick={(event) => {
        if (!dialogRef.current?.contains(event.target as Node)) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-lg bg-white shadow-xl"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-4">
          <h2 className="text-lg font-bold text-zinc-900">{title}</h2>
          <button type="button" onClick={close} aria-label={t('dialog.close')} className="rounded p-1 text-2xl leading-none text-zinc-500 hover:bg-zinc-100">
            ×
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {clashes && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-3">
              <p className="text-sm font-semibold text-amber-900">{t('clash.bookingTitle')}</p>
              <ul className="mt-1 mb-2 list-inside list-disc text-sm text-amber-800">
                {clashes.map((clash, index) => <li key={index}>{describeClash(clash, t)}</li>)}
              </ul>
              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={() => { setClashes(null); submit(true); }} className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                  {t('clash.bookAnyway')}
                </button>
                <button type="button" onClick={() => setClashes(null)} className="rounded border border-amber-300 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">
                  {t('clash.goBack')}
                </button>
              </div>
            </div>
          )}

          {target.mode === 'edit' ? (
            <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
              <span className="font-medium text-zinc-900">{target.customerName}</span>
              <span className="ml-2 text-zinc-500">· {t.dynamic(`status.${target.status}`, undefined, target.status)}</span>
            </div>
          ) : (
            <fieldset>
              <legend className={labelClass}>{t('dialog.customer')}</legend>
              {picked ? (
                <div className="flex items-center justify-between rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-zinc-900">{picked.name ?? t('appointment.customerFallback')}</span>
                    {picked.phone && <span className="ml-2 text-zinc-500">{picked.phone}</span>}
                  </span>
                  <button type="button" onClick={() => update({ picked: null, customerQuery: '' })} className="text-xs font-medium text-zinc-600 underline">
                    {t('dialog.change')}
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className={inputClass}
                    placeholder={t('dialog.searchPlaceholder')}
                    aria-label={t('dialog.searchLabel')}
                    value={customerQuery}
                    onChange={(event) => update({ customerQuery: event.target.value, name: event.target.value })}
                  />
                  {matches.length > 0 && (
                    <ul className="mt-1 divide-y divide-zinc-100 rounded border border-zinc-200">
                      {matches.map((match) => (
                        <li key={match.id}>
                          <button type="button" onClick={() => update({ picked: match })} className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50">
                            <span className="font-medium text-zinc-900">{match.name ?? t('appointment.customerFallback')}</span>
                            <span className="ml-2 text-zinc-500">{match.phone ?? match.email}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input className={inputClass} placeholder={t('dialog.phonePlaceholder')} aria-label={t('dialog.phonePlaceholder')} value={phone} onChange={(event) => update({ phone: event.target.value })} />
                    <input className={inputClass} type="email" placeholder={t('dialog.emailPlaceholder')} aria-label={t('dialog.emailPlaceholder')} value={email} onChange={(event) => update({ email: event.target.value })} />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{t('dialog.noEmailHelp')}</p>
                  <div className="mt-3">
                    <label className={labelClass} htmlFor="appt-customer-locale">{t('dialog.emailLanguage')}</label>
                    <select
                      id="appt-customer-locale"
                      className={inputClass}
                      value={customerLocale}
                      onChange={(event) => { if (isLocale(event.target.value)) update({ customerLocale: event.target.value }); }}
                    >
                      {LOCALES.map((option) => <option key={option} value={option} lang={option}>{LOCALE_LABEL[option]}</option>)}
                    </select>
                    <p className="mt-1 text-xs text-zinc-500">{t('dialog.emailLanguageHelp')}</p>
                  </div>
                </>
              )}
            </fieldset>
          )}

          <div>
            <label className={labelClass} htmlFor="appt-service">{t('dialog.service')}</label>
            <select id="appt-service" className={inputClass} value={serviceId} onChange={(event) => chooseService(event.target.value)}>
              {categories.map((category) => (
                <optgroup key={category} label={tp.dynamic(`categories.${category}`, undefined, category)}>
                  {offered.filter((service) => service.category === category).map((service) => (
                    <option key={service.id} value={service.id}>{optionLabel(service)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {selectedService?.requiresPatchTest && (
              <p className="mt-1 text-xs text-amber-700">{t('dialog.patchTestWarning')}</p>
            )}
          </div>

          {priceText && (
            <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2" aria-live="polite">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600">{priceHeading}</p>
              <p className="text-sm font-semibold text-zinc-900 tabular-nums">{priceText.amount}</p>
              {priceText.notes.length > 0 && <p className="text-[11px] leading-snug text-zinc-500">{priceText.notes.join(' · ')}</p>}
              {priceHelp && <p className="mt-1 text-xs text-zinc-500">{priceHelp}</p>}
            </div>
          )}

          {pendingChange && (
            <p role="alert" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t('dialog.price.changed', { amount: formatPrice(pendingChange.amountPence) })}
            </p>
          )}

          <div>
            <label className={labelClass} htmlFor="appt-stylist">{t('dialog.stylist')}</label>
            <select id="appt-stylist" className={inputClass} value={stylistId} onChange={(event) => update({ stylistId: event.target.value })}>
              {stylists.map((stylist) => <option key={stylist.id} value={stylist.id}>{stylist.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelClass} htmlFor="appt-date">{t('dialog.date')}</label>
              <input id="appt-date" type="date" className={inputClass} value={dateStr} onChange={(event) => update({ dateStr: event.target.value })} />
            </div>
            <div>
              <label className={labelClass} htmlFor="appt-time">{t('dialog.start')}</label>
              <input id="appt-time" type="time" step={900} className={inputClass} value={time} onChange={(event) => update({ time: event.target.value })} />
            </div>
            <div>
              <label className={labelClass} htmlFor="appt-duration">{t('dialog.minutes')}</label>
              <input
                id="appt-duration"
                type="number"
                min={MIN_DURATION_MINUTES}
                step={MIN_DURATION_MINUTES}
                className={inputClass}
                value={durationMin}
                onChange={(event) => update({ durationMin: Number(event.target.value) })}
              />
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="appt-notes">{t('dialog.notes')}</label>
            <textarea id="appt-notes" rows={2} className={inputClass} value={notes} onChange={(event) => update({ notes: event.target.value })} placeholder={t('dialog.notesPlaceholder')} />
          </div>

          {!isEdit && (
            <div className="space-y-2 rounded border border-zinc-200 bg-zinc-50 px-3 py-3">
              <label className="flex items-center gap-2 text-sm text-zinc-800">
                <input type="checkbox" checked={status === 'PENDING'} onChange={(event) => update({ status: event.target.checked ? 'PENDING' : 'CONFIRMED' })} />
                {t('dialog.pencilIn')}
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-800">
                <input type="checkbox" checked={notifyCustomer} disabled={status === 'PENDING'} onChange={(event) => update({ notifyCustomer: event.target.checked })} />
                {t('dialog.emailConfirmation')}
              </label>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-zinc-200 bg-white px-5 py-3">
          {isEdit && (target.status === 'PENDING' || target.status === 'CONFIRMED') && (
            <button type="button" disabled={saving} onClick={cancelBooking} className="mr-auto rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
              {t('dialog.cancelBooking')}
            </button>
          )}
          <button type="button" disabled={saving} onClick={close} className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
            {isEdit ? t('dialog.close') : t('dialog.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || !serviceId || !stylistId}
            onClick={() => submit(false)}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
