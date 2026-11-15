'use client';

import { useEffect, useRef, useState } from 'react';
import { createAppointmentByAdmin, editAppointmentByAdmin, searchAdminCustomers, type AdminCustomerMatch, type AdminQuote } from '@/app/actions/admin-schedule';
import type { MoveClash } from '@/app/services/admin-move-clashes';
import { describeClash } from '@/app/lib/describe-clash';
import { describeBoardPrice, type BoardPrice } from '@/app/lib/board-price';
import { MIN_DURATION_MINUTES } from '@/app/lib/calendar-geometry';
import { formatGBP } from '@/app/services/pricing/money';
import { RescheduleRequestActions } from './RescheduleRequestActions';
import { DepositChip } from './DepositChip';
import { DepositRecheckButton } from './DepositRecheckButton';
import { DepositSettleRefundButton } from './DepositSettleRefundButton';
import {
  ConsultationCreditOption,
  useConsultationCreditPreview,
  type ConsultationCreditLookup,
  type RecordedConsultationCredit,
} from './ConsultationCreditOption';
import type { DepositView } from '@/app/lib/deposit-display';
import { isRescheduleRequestMoot } from '@/app/lib/reschedule-request';
import { isArrivalWindowOpen, lateCancelDueAt } from '@/app/lib/late-arrival';
import { DEPOSIT_REFUND_NOTICE_HOURS, LATE_ARRIVAL_CANCEL_MINUTES } from '@/app/lib/booking-constants';
import { formatSalonClock, formatSalonLongDate } from '@/i18n/dates';
import { toTelHref } from '@/app/lib/phone';
import { useLocale, useT } from '@/i18n/client';
import { DEFAULT_LOCALE, HTML_LANG, LOCALE_LABEL, LOCALES, isLocale, type Locale } from '@/i18n/config';
import { clearDraft, useDraftState } from '@/i18n/draft-store';
import { resolveSalonDateTime, salonDateKey } from '@/app/services/salon-time';

/** One row of the dialog's service menu (see admin-calendar-data). */
export type DialogService = {
  id: string;
  name: string;
  duration: number;
  category: string;
  requiresPatchTest: boolean;
  /** A treatment a consultation's fee is credited against (consultation-credit.ts). */
  requiresConsultation: boolean;
  amountPence: number;
  priceVersion: number;
  priceType: string;
  hairLength: string | null;
  vatDisplay: string;
  priceNature: string;
  /** False for retired/unverified options: never offered for a new booking or a service change. */
  isBookable: boolean;
  offeringId: string | null;
  offering?: { name: string; searchText: string } | null;
  /** Both the original and translated name, for local bilingual search. */
  searchText?: string;
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
      /** The customer's phone and email as staff can use them (no walk-in or erased placeholder), when known. */
      customerPhone?: string | null;
      customerEmail?: string | null;
      status: string;
      updatedAt: string;
      /** The price recorded on the appointment — never re-derived from today's list. */
      price: BoardPrice;
      /** The booking's current start (ISO instant): a request on a past visit is moot. */
      date: string;
      /** An open customer reschedule request (ISO instants), if any. */
      rescheduleRequestedDate: string | null;
      rescheduleRequestedAt: string | null;
      /** The booking's card deposit (lib/deposit-display.ts), when it has one. */
      deposit?: DepositView | null;
      /** Moved at the customer's request made inside DEPOSIT_REFUND_NOTICE_HOURS: their own cancellation keeps the deposit. */
      depositLocked?: boolean;
      /** When staff marked the customer arrived (ISO instant); the late-arrival rule never cancels an arrived booking. */
      arrivedAt?: string | null;
      /** The consultation credit staff applied to this booking, if any. */
      consultationCredit?: RecordedConsultationCredit | null;
    };

/**
 * Every field an admin can type, kept in one draft so an interface-language
 * switch mid-edit (which remounts the page) hands it back intact.
 */
type DialogForm = {
  serviceId: string;
  serviceSearch?: string;
  serviceCategory?: string;
  stylistId: string;
  dateStr: string;
  time: string;
  durationMin: string | number;
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
  /** Cancelling a confirmed booking whose deposit was taken: refund it (ticked by default; unticked for a no-show) or keep it. */
  refundDeposit: boolean;
  /**
   * The admin's own tick or untick of "Consultation credit — deduct from this
   * booking", with the question (customer, service, time) it was made on.
   * Null until they touch the box.
   */
  creditChoice: { key: string; apply: boolean } | null;
};

const inputClass =
  'min-w-0 w-full rounded-md border border-zinc-300 px-3 py-2 text-base sm:text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900';
const labelClass = 'mb-1 block text-sm font-medium text-zinc-700';

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
  onRefresh,
}: {
  target: DialogTarget;
  services: DialogService[];
  stylists: DialogStylist[];
  onClose: () => void;
  onSaved: () => void;
  /** Reload the board without closing the dialog: a refused change may mean the booking moved on. */
  onRefresh?: () => void;
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
    durationMin: String(isEdit ? target.durationMin : bookable[0]?.duration ?? 30),
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
    // A no-show keeps its deposit (salon policy, /booking-terms): once a
    // confirmed visit's time has passed, cancelling starts at "keep".
    refundDeposit: !(isEdit && target.status === 'CONFIRMED' && new Date(target.date).getTime() <= Date.now()),
    creditChoice: null,
  }));
  const update = (patch: Partial<DialogForm>) => setForm((previous) => ({ ...previous, ...patch }));
  const { serviceId, stylistId, dateStr, time, durationMin, notes, status, notifyCustomer, customerQuery, picked, name, email, phone, customerLocale, priceChange } = form;
  // Old locale-switch drafts stored minutes as a number; new edits keep text.
  const durationText = String(durationMin);
  const parsedDuration = /^\d+$/.test(durationText) ? Number(durationText) : NaN;
  const validDuration = Number.isInteger(parsedDuration) && parsedDuration >= MIN_DURATION_MINUTES && parsedDuration <= 720;
  const startsAt = resolveSalonDateTime(dateStr, time).utc;
  const endsAt = validDuration && !Number.isNaN(startsAt.getTime())
    ? new Date(startsAt.getTime() + parsedDuration * 60_000) : null;
  // A draft saved before this field existed has none: refund, the default.
  const refundDeposit = form.refundDeposit !== false;

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

  // A customer's own saved email language always wins; the dialog asks only
  // when none is on file (a new walk-in, or an account without one yet).
  const savedLocale = picked && isLocale(picked.preferredLocale) ? picked.preferredLocale : null;

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
    update({ serviceId: id, priceChange: null, ...(next ? { durationMin: String(next.duration) } : {}) });
  };

  // Consultation credit (spec §2.3): only a consultation-required service takes
  // one. The server looks it up again on save; the dialog sends only the box.
  const takesCredit = selectedService?.requiresConsultation === true;
  const recordedCredit = target.mode === 'edit' ? target.consultationCredit ?? null : null;
  const typedEmail = email.trim();
  const creditLookup: ConsultationCreditLookup | null = !takesCredit
    ? null
    : target.mode === 'edit'
      ? { appointmentId: target.appointmentId, serviceId, dateStr, time }
      : picked
        ? { customerId: picked.id, serviceId, dateStr, time }
        // A typed email already on file books onto that customer (resolveCustomer).
        : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail)
          ? { email: typedEmail, serviceId, dateStr, time }
          : null;
  const creditKey = creditLookup ? JSON.stringify(creditLookup) : '';
  const creditPreview = useConsultationCreditPreview(creditLookup);
  const creditAnswer = takesCredit && creditPreview.state === 'answered' ? creditPreview.preview : null;
  // Save waits for the answer, so a booking is never saved before staff could see its credit.
  const creditChecking = takesCredit && creditPreview.state === 'checking';
  // Where the box starts: ticked for a new booking (again whenever its customer,
  // service or time changes); for an edit, as the booking stands — a credit that
  // became available is added only by ticking it.
  const choice = form.creditChoice ?? null;
  const applyConsultationCredit = isEdit
    ? (choice ? choice.apply : recordedCredit !== null)
    : (choice?.key === creditKey ? choice.apply : true);
  // Sent only for what the admin could see: the box, shown for this exact
  // question, or (editing) the note that saving removes a credit that no
  // longer applies. Otherwise omitted, and the server leaves the credit as it
  // is — a new booking gets none.
  const creditChoice = !creditAnswer
    ? {}
    : creditAnswer.available
      ? { applyConsultationCredit }
      : recordedCredit ? { applyConsultationCredit: false } : {};

  /** The price the admin is looking at right now, sent back so the server can refuse a stale one. */
  const expectedQuote = () => {
    if (!pricing || !selectedService) return undefined;
    const shown = pendingChange ?? selectedService;
    return { serviceId, priceVersion: shown.priceVersion, amountPence: shown.amountPence };
  };

  const submit = async (overrideClashes: boolean) => {
    if (!validDuration) return;
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        const result = await editAppointmentByAdmin({
          appointmentId: target.appointmentId,
          dateStr,
          time,
          durationMin: parsedDuration,
          stylistId,
          serviceId,
          notes,
          overrideClashes,
          expectedUpdatedAt: target.updatedAt,
          expectedQuote: expectedQuote(),
          ...creditChoice,
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
        durationMin: parsedDuration,
        status,
        notes,
        notifyCustomer,
        overrideClashes,
        expectedQuote: expectedQuote(),
        ...(savedLocale ? {} : { customerLocale }),
        ...creditChoice,
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
    if (!window.confirm(cancelConfirmText())) return;
    setSaving(true);
    setError(null);
    try {
      const { updateAppointmentStatus } = await import('@/app/actions/admin');
      // Only a confirmed booking's taken deposit may be kept; a request's always goes back.
      const result = await updateAppointmentStatus(target.appointmentId, 'CANCELLED', { refundDeposit: !keepChoice || refundDeposit });
      if (result.success) return saved();
      setError(result.error ?? t('dialog.cancelFailed'));
    } catch {
      setError(t('dialog.cancelUnknown'));
    } finally {
      setSaving(false);
    }
  };

  // Arrived / Not arrived (late-arrival rule, actions/admin-arrivals.ts).
  const toggleArrived = async () => {
    if (target.mode !== 'edit' || saving) return;
    // Past the 15-minute mark, "not arrived" lets the next run cancel the booking.
    if (target.arrivedAt && Date.now() >= lateCancelDueAt(target.date).getTime()
      && !window.confirm(t('arrivals.clearArrivedConfirm', { minutes: LATE_ARRIVAL_CANCEL_MINUTES }))) return;
    setSaving(true);
    setError(null);
    try {
      const { markArrived } = await import('@/app/actions/admin-arrivals');
      const result = await markArrived(target.appointmentId, !target.arrivedAt);
      if (result.success) return saved();
      setError(result.error);
      // Refused: the rule or a colleague may have changed the booking meanwhile.
      onRefresh?.();
    } catch {
      // The request itself failed: say so here, never in the error boundary.
      setError(t('appointment.updateFailed'));
      onRefresh?.();
    } finally {
      setSaving(false);
    }
  };

  const formatPrice = (pence: number) => formatGBP(pence, HTML_LANG[locale]);

  // The booking's card deposit: a confirmed booking's taken deposit can be
  // refunded (default) or kept; a request's hold is released.
  const deposit = target.mode === 'edit' ? target.deposit ?? null : null;
  const keepChoice = target.mode === 'edit' && target.status === 'CONFIRMED' && deposit?.state === 'PAID';
  // Read once when the dialog opens (a no-show keeps its deposit: the help text says so).
  const [visitPassed] = useState(() => target.mode === 'edit' && new Date(target.date).getTime() <= Date.now());
  function cancelConfirmText() {
    const customer = target.mode === 'edit' ? target.customerName : '';
    if (deposit?.state === 'PAID') {
      const amount = formatPrice(deposit.amountPence);
      return keepChoice && !refundDeposit ? t('deposit.cancelKeepConfirm', { customer, amount }) : t('deposit.cancelRefundConfirm', { customer, amount });
    }
    if (deposit?.state === 'HELD') return t('deposit.cancelReleaseConfirm', { customer, amount: formatPrice(deposit.amountPence) });
    return t('dialog.cancelConfirm', { customer });
  }
  const optionLabel = (service: DialogService) => {
    // Length and NHS come from the option's stable fields, not its name, so
    // the menu reads the same in either language.
    const tags = [
      service.hairLength ? tp.dynamic(`hairLength.${service.hairLength}`, undefined, '') : '',
      tp.dynamic(`priceType.${service.priceType}`, undefined, service.priceType),
    ].filter(Boolean);
    const label = t('dialog.option', {
      label: service.offering ? tags.join(' · ') : [service.name, ...tags].join(' · '),
      duration: tp('minutes', { count: service.duration }),
      price: formatPrice(service.amountPence),
    });
    return service.isBookable ? label : t('dialog.retiredOption', { label });
  };
  const categories = [...new Set(offered.map((service) => service.category))];
  // Group by the stable relation only. Legacy standalone services keep their own row.
  const groups = new Map<string, { id: string; name: string; category: string; options: DialogService[] }>();
  for (const service of offered) {
    const id = service.offeringId ? `offering:${service.offeringId}` : `service:${service.id}`;
    const group = groups.get(id) ?? { id, name: service.offering?.name ?? service.name, category: service.category, options: [] };
    group.options.push(service);
    groups.set(id, group);
  }
  const serviceSearch = form.serviceSearch ?? '';
  const serviceCategory = form.serviceCategory ?? '';
  const serviceNeedle = serviceSearch.trim().toLocaleLowerCase();
  const visibleGroups = [...groups.values()].filter((group) =>
    (!serviceCategory || group.category === serviceCategory) && (!serviceNeedle ||
      [group.name, ...group.options.flatMap((option) => [option.name, option.searchText ?? '', option.offering?.searchText ?? ''])]
        .join(' ').toLocaleLowerCase().includes(serviceNeedle)));
  const selectedGroup = visibleGroups.find((group) => group.options.some((option) => option.id === serviceId));

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

  const languageField = savedLocale ? (
    <p className="mt-2 text-xs text-zinc-500">{t('dialog.emailLanguageSaved', { language: LOCALE_LABEL[savedLocale] })}</p>
  ) : (
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
      <p className="mt-1 text-xs text-zinc-500">{picked ? t('dialog.emailLanguageUnsetHelp') : t('dialog.emailLanguageHelp')}</p>
    </div>
  );

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
        className="flex max-h-[92dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 sm:px-5">
          <h2 className="text-lg font-bold text-zinc-900">{title}</h2>
          <button type="button" onClick={close} aria-label={t('dialog.close')} className="rounded p-1 text-2xl leading-none text-zinc-500 hover:bg-zinc-100">
            ×
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto space-y-4 px-4 py-4 sm:px-5">
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
              {deposit && <DepositChip deposit={deposit} t={t} className="ml-2 align-middle" />}
              {/* Asks Square now: a stuck hold, an unclear capture or a pending refund. */}
              {deposit && <DepositRecheckButton appointmentId={target.appointmentId} />}
              {/* A refund Square has not confirmed, which staff refunded themselves (Square Dashboard or cash).
                  Mounted for any deposit, so its answer outlives the refresh that drops the refund. */}
              {deposit && <DepositSettleRefundButton appointmentId={target.appointmentId} refund={deposit.refundToSettle ?? null} />}
              {/* How staff reach the customer about this booking: tap to call or email. */}
              {target.customerPhone || target.customerEmail ? (
                <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-zinc-700">
                  {target.customerPhone && (
                    <span>{t('dialog.customerPhone')}: <a href={toTelHref(target.customerPhone)} className="underline">{target.customerPhone}</a></span>
                  )}
                  {target.customerEmail && (
                    <span className="break-all">{t('dialog.customerEmail')}: <a href={`mailto:${target.customerEmail}`} className="underline">{target.customerEmail}</a></span>
                  )}
                </p>
              ) : (
                <p className="mt-1 text-zinc-500">{t('dialog.noCustomerContact')}</p>
              )}
            </div>
          ) : (
            <fieldset>
              <legend className={labelClass}>{t('dialog.customer')}</legend>
              {picked ? (
                <>
                  <div className="flex items-center justify-between rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium text-zinc-900">{picked.name ?? t('appointment.customerFallback')}</span>
                      {picked.phone && <span className="ml-2 text-zinc-500">{picked.phone}</span>}
                    </span>
                    <button type="button" onClick={() => update({ picked: null, customerQuery: '' })} className="text-xs font-medium text-zinc-600 underline">
                      {t('dialog.change')}
                    </button>
                  </div>
                  {languageField}
                </>
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
                  {languageField}
                </>
              )}
            </fieldset>
          )}

          {target.mode === 'edit' && target.rescheduleRequestedDate && target.rescheduleRequestedAt && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p>{t('rescheduleRequests.dialogNote', { to: `${formatSalonLongDate(locale, new Date(target.rescheduleRequestedDate))} ${formatSalonClock(locale, new Date(target.rescheduleRequestedDate))}` })}</p>
              <div className="mt-2">
                <RescheduleRequestActions appointmentId={target.appointmentId} requestedAt={target.rescheduleRequestedAt}
                  expired={isRescheduleRequestMoot({ date: target.date, rescheduleRequestedDate: target.rescheduleRequestedDate })} onDone={saved} />
              </div>
            </div>
          )}

          <div className="min-w-0 rounded-xl border border-zinc-200 p-3">
            <p className={labelClass}>{t('dialog.service')}</p>
            {selectedService && <div className="mb-2 text-sm text-zinc-900">
              <p>{selectedService.offering?.name ?? selectedService.name}</p>
              <p className="text-xs text-zinc-500">{[
                selectedService.hairLength ? tp.dynamic(`hairLength.${selectedService.hairLength}`, undefined, '') : '',
                tp.dynamic(`priceType.${selectedService.priceType}`, undefined, selectedService.priceType),
              ].filter(Boolean).join(' · ')}</p>
            </div>}
            <details open={!isEdit}>
              <summary className="cursor-pointer py-1 text-sm font-medium text-zinc-600 underline underline-offset-4">{t('servicePicker.change')}</summary>
              <div className="mt-3 space-y-3">
                <div>
                  <label className={labelClass} htmlFor="appt-service-category">{t('servicePicker.category')}</label>
                  <select id="appt-service-category" className={inputClass} value={serviceCategory} onChange={(event) => update({ serviceCategory: event.target.value })}>
                    <option value="">{t('servicePicker.allCategories')}</option>
                    {categories.map((category) => <option key={category} value={category}>{tp.dynamic(`categories.${category}`, undefined, category)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="appt-service-search">{t('servicePicker.search')}</label>
                  <input id="appt-service-search" type="search" className={inputClass} value={serviceSearch} placeholder={t('servicePicker.searchPlaceholder')} onChange={(event) => update({ serviceSearch: event.target.value })} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="appt-offering">{t('servicePicker.offering')}</label>
                  <select id="appt-offering" className={inputClass} value={selectedGroup?.id ?? ''} onChange={(event) => {
                    const group = visibleGroups.find((item) => item.id === event.target.value);
                    if (group) chooseService(group.options[0].id);
                  }}>
                    <option value="" disabled>{t('servicePicker.chooseOffering')}</option>
                    {visibleGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </select>
                  {visibleGroups.length === 0 && <p role="status" className="mt-2 text-sm text-zinc-500">{t('servicePicker.noMatches')}</p>}
                </div>
                {selectedGroup && <div>
                  <label className={labelClass} htmlFor="appt-service">{t('servicePicker.option')}</label>
                  <select id="appt-service" className={inputClass} value={serviceId} onChange={(event) => chooseService(event.target.value)}>
                    {selectedGroup.options.map((service) => <option key={service.id} value={service.id}>{optionLabel(service)}</option>)}
                  </select>
                </div>}
              </div>
            </details>
            {selectedService?.requiresPatchTest && (
              <p className="mt-1 text-xs text-amber-700">{t('dialog.patchTestWarning')}</p>
            )}
          </div>

          {priceText && (
            <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2" aria-live="polite">
              <p className="text-xs font-medium text-zinc-600">{priceHeading}</p>
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

          {takesCredit ? (
            <ConsultationCreditOption
              preview={creditPreview}
              apply={applyConsultationCredit}
              onApplyChange={(apply) => update({ creditChoice: { key: creditKey, apply } })}
              recorded={recordedCredit}
            />
          ) : recordedCredit && pricing && (
            // Only a service CHANGE clears it on save (editAppointmentByAdmin); an unchanged one keeps it.
            <p className="text-xs text-zinc-500">{t('credit.clearedByService', { amount: formatPrice(recordedCredit.amountPence) })}</p>
          )}

          <div>
            <label className={labelClass} htmlFor="appt-stylist">{t('dialog.stylist')}</label>
            <select id="appt-stylist" className={inputClass} value={stylistId} onChange={(event) => update({ stylistId: event.target.value })}>
              {stylists.map((stylist) => <option key={stylist.id} value={stylist.id}>{stylist.name}</option>)}
            </select>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-2 min-w-0 sm:col-span-1">
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
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className={inputClass}
                value={durationText}
                aria-invalid={!validDuration}
                aria-describedby={!validDuration ? 'appt-duration-error' : 'appt-end-preview'}
                onChange={(event) => {
                  const value = event.target.value;
                  update({ durationMin: /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, '') : value });
                }}
              />
            </div>
          </div>
          {!validDuration && <p id="appt-duration-error" role="alert" className="text-sm text-red-700">{t('dialog.durationInvalid')}</p>}
          {endsAt && <p id="appt-end-preview" aria-live="polite" className="text-sm text-zinc-500">{t(salonDateKey(endsAt) !== dateStr ? 'dialog.endsNextDay' : 'dialog.endsAt', { time: formatSalonClock(locale, endsAt) })}</p>}

          <div>
            <label className={labelClass} htmlFor="appt-notes">{t('dialog.notes')}</label>
            <textarea id="appt-notes" rows={2} className={inputClass} value={notes} onChange={(event) => update({ notes: event.target.value })} placeholder={t('dialog.notesPlaceholder')} />
          </div>

          {keepChoice && deposit && (
            <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-3">
              <label className="flex items-center gap-2 text-sm text-zinc-800">
                <input type="checkbox" checked={refundDeposit} onChange={(event) => update({ refundDeposit: event.target.checked })} />
                {t('deposit.refund', { amount: formatPrice(deposit.amountPence) })}
              </label>
              <p className="mt-1 text-xs text-zinc-500">{visitPassed ? t('deposit.noShowHelp') : target.mode === 'edit' && target.depositLocked ? t('deposit.lockedHelp', { hours: DEPOSIT_REFUND_NOTICE_HOURS }) : t('deposit.refundHelp', { hours: DEPOSIT_REFUND_NOTICE_HOURS })}</p>
            </div>
          )}
          {isEdit && target.status === 'PENDING' && deposit?.state === 'HELD' && (
            <p className="text-xs text-zinc-500">{t('deposit.releaseNote', { amount: formatPrice(deposit.amountPence) })}</p>
          )}

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

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-zinc-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          {isEdit && (target.status === 'PENDING' || target.status === 'CONFIRMED') && (
            <button type="button" disabled={saving} onClick={cancelBooking} className="mr-auto rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
              {t('dialog.cancelBooking')}
            </button>
          )}
          {isEdit && target.status === 'CONFIRMED' && isArrivalWindowOpen(target.date, target.durationMin) && (
            <button type="button" disabled={saving} onClick={toggleArrived}
              className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50">
              {target.arrivedAt ? t('arrivals.clearArrived') : t('arrivals.markArrived')}
            </button>
          )}
          <button type="button" disabled={saving} onClick={close} className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
            {isEdit ? t('dialog.close') : t('dialog.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || !serviceId || !stylistId || creditChecking || !validDuration}
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
