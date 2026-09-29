'use client';

import { Stylist } from '@prisma/client';
import type { ClientPublicService } from '@/app/services/public-service-select';
import type { ClientOffering, PriceListEntry } from '@/app/services/pricing/public-catalog';
import { format, addDays, startOfToday } from 'date-fns';
import { useState, useEffect, useMemo } from 'react';
import Link from '@/i18n/link';
import { fetchBookingDays, submitBooking, type ClientQuote } from '@/app/actions/booking';
import type { BookingDay } from '@/app/services/booking-days';
import { DayChip, TimeSlotGrid, UnavailableDayBlock } from './DayAvailability';
import { ANY_STYLIST_ID, BOOKING_DAYS_MAX } from '@/app/lib/booking-constants';
import { resolveConsultationTarget } from '@/app/services/consultation-routing';
import { useLocale, useT } from '@/i18n/client';
import { useDraftState, clearDraft } from '@/i18n/draft-store';
import { formatCalendarDay } from '@/i18n/dates';
import { Duration, OptionLabel, PriceFinePrint, SurchargeBreakdown, useCategoryLabel, useFormatPrice } from '@/components/pricing/PriceParts';

// Services reach the browser through the public select, so this type must
// stay narrower than the full Service row (see app/services/public-service-select.ts).
type ClientService = ClientPublicService;

// Only the public-safe fields the page passes down (never the full Stylist row,
// which carries the secret treatwellIcalUrl).
type PublicStylist = Pick<Stylist, 'id' | 'name' | 'role' | 'imageUrl'>;

type Step = 'SERVICE' | 'STYLIST' | 'DATE' | 'CONFIRM';

interface BookingWizardProps {
  services: ClientService[];
  offerings: ClientOffering[];
  categories: { category: string; entries: PriceListEntry[] }[];
  stylists: PublicStylist[];
}

const STEPS: Step[] = ['SERVICE', 'STYLIST', 'DATE', 'CONFIRM'];
const DRAFT = 'booking-wizard';

/** Reached through routing (consultation gates), never browsed directly. */
const isRoutingTarget = (service: ClientService) => service.isConsultation || service.isPatchTest;
/** Can be picked in the wizard: bookable, or a consultation-routed service whose price is shown. */
const isSelectable = (service: ClientService) => service.isBookable || service.requiresConsultation;

export function BookingWizard({ services, offerings, categories, stylists }: BookingWizardProps) {
  const t = useT('booking');
  const tp = useT('pricing');
  const tc = useT('common');
  const locale = useLocale();
  const formatPrice = useFormatPrice();
  const categoryLabel = useCategoryLabel();

  // Everything the customer has chosen survives a language switch (in memory
  // only — see i18n/draft-store.ts). Server lookups (slots, colour gate) are
  // simply fetched again for the restored selection.
  const [step, setStep] = useDraftState<Step>(`${DRAFT}:step`, 'SERVICE');
  const [selectedServiceId, setSelectedServiceId] = useDraftState<string | null>(`${DRAFT}:service`, null);
  const [selectedStylistId, setSelectedStylistId] = useDraftState<string | null>(`${DRAFT}:stylist`, null);
  const [selectedDay, setSelectedDay] = useDraftState<string>(`${DRAFT}:day`, () => format(startOfToday(), 'yyyy-MM-dd'));
  const [selectedTime, setSelectedTime] = useDraftState<string | null>(`${DRAFT}:time`, null);
  // Set when the customer picked a consultation-gated service. Holds the ORIGINAL
  // service so we can label the consultation and record intent on submit.
  const [consultationOriginId, setConsultationOriginId] = useDraftState<string | null>(`${DRAFT}:origin`, null);
  // The gate panel for the service the customer just clicked (before they confirm).
  const [pendingGateId, setPendingGateId] = useDraftState<string | null>(`${DRAFT}:gate`, null);
  const [openOfferingId, setOpenOfferingId] = useDraftState<string | null>(`${DRAFT}:offering`, null);
  const [pendingOptionId, setPendingOptionId] = useDraftState<string | null>(`${DRAFT}:option`, null);
  const [searchTerm, setSearchTerm] = useDraftState(`${DRAFT}:search`, '');
  // Only categories with something the customer can pick (the Consultation
  // category holds just a routing target, which is never browsed).
  const browsable = useMemo(() => categories
    .map((group) => ({
      ...group,
      entries: group.entries
        .map((entry): PriceListEntry | null => {
          if (entry.kind === 'single') return isRoutingTarget(entry.service) || !isSelectable(entry.service) ? null : entry;
          const options = entry.options.filter((option) => !isRoutingTarget(option));
          return options.length ? { ...entry, options } : null;
        })
        .filter((entry): entry is PriceListEntry => entry !== null),
    }))
    .filter((group) => group.entries.length > 0), [categories]);
  const [selectedCategory, setSelectedCategory] = useDraftState<string>(`${DRAFT}:category`, () => browsable[0]?.category ?? 'Haircuts');
  const [isSubmitted, setIsSubmitted] = useDraftState(`${DRAFT}:submitted`, false);
  // A newer price the server returned instead of booking: the customer must
  // see it and confirm again. Keyed by service so a different choice drops it.
  const [repricedQuote, setRepricedQuote] = useDraftState<ClientQuote | null>(`${DRAFT}:reprice`, null);

  const [bookingDays, setBookingDays] = useState<BookingDay[]>([]);
  // Separate from isLoading (the submit button): a reload after a refused
  // booking must not make the button show "Processing…" again.
  const [daysLoading, setDaysLoading] = useState(false);
  // Bumped after a booking attempt is refused so the fortnight is re-read.
  const [daysVersion, setDaysVersion] = useState(0);
  // True when the last slot lookup failed (vs a genuinely empty day) — lets us
  // show "couldn't load times" instead of implying the salon is fully booked.
  const [slotLoadFailed, setSlotLoadFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  // Colour patch-test gate: populated when a colour service + date are selected
  const [colourGate, setColourGate] = useState<{ eligible: boolean; reason: string; testDate: string | null } | null>(null);

  const serviceById = useMemo(() => new Map(services.map((service) => [service.id, service])), [services]);
  const offeringById = useMemo(() => new Map(offerings.map((offering) => [offering.id, offering])), [offerings]);
  const selectedService = selectedServiceId ? serviceById.get(selectedServiceId) ?? null : null;
  const consultationOrigin = consultationOriginId ? serviceById.get(consultationOriginId) ?? null : null;
  const pendingGate = useMemo(() => {
    const service = pendingGateId ? serviceById.get(pendingGateId) : undefined;
    if (!service) return null;
    const routed = resolveConsultationTarget(service, services);
    return { service, fee: routed?.target.amountPence ?? 0, hasTarget: routed !== null };
  }, [pendingGateId, serviceById, services]);
  const selectedStylist = selectedStylistId === ANY_STYLIST_ID
    ? { id: ANY_STYLIST_ID, name: t('stylist.anyone'), role: t('stylist.firstAvailable') }
    : stylists.find((stylist) => stylist.id === selectedStylistId) ?? null;
  const activeQuote = repricedQuote && repricedQuote.serviceId === selectedService?.id ? repricedQuote : null;

  /** "Full Head Colour & Blow Dry · Long hair" for an option; the service name otherwise. */
  const displayName = (service: ClientService) => {
    const offering = service.offeringId ? offeringById.get(service.offeringId) : undefined;
    if (!offering) return service.name;
    const length = service.hairLength ? tp.dynamic(`hairLength.${service.hairLength}`) : null;
    return length ? `${offering.name} · ${length}` : offering.name;
  };

  const dayString = selectedDay;
  const days = useMemo(() => Array.from({ length: BOOKING_DAYS_MAX }, (_, offset) => format(addDays(startOfToday(), offset), 'yyyy-MM-dd')), []);

  // One request per stylist/service fills the whole date strip and every day's
  // times; changing the day is then instant and costs no extra database work.
  useEffect(() => {
    if (selectedStylist && selectedService) {
      let cancelled = false;
      const loadDays = async () => {
        setDaysLoading(true);
        setSlotLoadFailed(false);
        try {
          const result = await fetchBookingDays(selectedStylist.id, days, selectedService.duration);
          // Ignore a response that arrived after the inputs changed (out-of-order guard)
          if (cancelled) return;
          if (result.ok) {
            setBookingDays(result.days);
            // A chosen time that is no longer free (e.g. after a refused booking) is dropped.
            const chosenDay = result.days.find((day) => day.date === dayString);
            setSelectedTime((time) => (time && !chosenDay?.slots.some((slot) => slot.available && slot.time === time) ? null : time));
          } else {
            setBookingDays([]);
            setSlotLoadFailed(true);
          }
        } catch {
          if (cancelled) return;
          setBookingDays([]);
          setSlotLoadFailed(true);
        } finally {
          if (!cancelled) setDaysLoading(false);
        }
      };
      loadDays();
      return () => { cancelled = true; };
    }
    // selectedStylist is derived from its id each render; the id is the dependency.
    // The day is deliberately not one: every day arrives in the same response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStylistId, selectedService, days, daysVersion]);

  const dayInfo = bookingDays.find((day) => day.date === dayString) ?? null;
  const isUnavailable = (day: string) => bookingDays.find((entry) => entry.date === day)?.status === 'UNAVAILABLE';

  // Check colour patch-test eligibility whenever a colour service + date is selected
  useEffect(() => {
    if (!selectedService || !selectedService.requiresPatchTest) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets gate when service changes; new rule from eslint-config-next 16.2.10, pre-existing pattern
      setColourGate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { checkColourEligibility } = await import('@/app/actions/booking');
      const res = await checkColourEligibility(selectedService.id, dayString);
      if (!cancelled) {
        setColourGate({ eligible: res.eligible, reason: res.reason, testDate: res.testDate });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedService, dayString]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStylist || !selectedService || !selectedTime) return;
    // Block ineligible colour bookings client-side (server is still source of truth)
    if (colourGate && !colourGate.eligible) return;

    setIsLoading(true);
    setBookingError(null);
    try {
      const result = await submitBooking({
        stylistId: selectedStylist.id,
        serviceId: selectedService.id,
        // Send the salon-local calendar day the customer saw as a plain string so
        // the server (slot grid, conflict window and weekday) all share one day
        // frame — a browser-local Date would drift a day under BST.
        date: dayString,
        time: selectedTime,
        consultationForServiceId: consultationOrigin?.id,
        // The exact price on screen. If the price list changed meanwhile the
        // server books nothing and returns the new price to confirm.
        expectedQuote: activeQuote
          ? { serviceId: activeQuote.serviceId, priceVersion: activeQuote.priceVersion, amountPence: activeQuote.amountPence }
          : { serviceId: selectedService.id, priceVersion: selectedService.priceVersion, amountPence: selectedService.amountPence },
      });

      if (result.success) {
        setIsSubmitted(true);
        setRepricedQuote(null);
      } else if (result.quote) {
        setRepricedQuote(result.quote);
        setBookingError(t('confirm.priceChanged'));
      } else {
        setBookingError(result.error || t('confirm.bookingFailed'));
        // The time may have just been taken: re-read the fortnight.
        setDaysVersion((version) => version + 1);
      }
    } catch {
      // A rejected action (dropped connection, DB error) must not leave the
      // button stuck on "Processing…" — surface a message and re-enable it.
      setBookingError(t('confirm.genericError'));
    } finally {
      setIsLoading(false);
    }
  };

  const term = searchTerm.trim().toLowerCase();
  const visibleEntries = (browsable.find((group) => group.category === selectedCategory)?.entries ?? [])
    .filter((entry) => !term || (entry.kind === 'single'
      ? entry.service.searchText.includes(term)
      : entry.offering.searchText.includes(term) || entry.options.some((option) => option.searchText.includes(term))));

  // Called when a service option is chosen. Gated services open the consultation
  // gate instead of proceeding straight to stylist selection.
  const handleSelectService = (service: ClientService) => {
    setRepricedQuote(null);
    if (service.requiresConsultation) {
      setPendingGateId(service.id);
      return;
    }
    if (!service.isBookable) return;
    setPendingGateId(null);
    setConsultationOriginId(null);
    setSelectedServiceId(service.id);
    setSelectedTime(null);
    setStep('STYLIST');
  };

  // Confirm the gate: swap to the consultation target and continue the flow.
  const confirmConsultation = () => {
    if (!pendingGate) return;
    const routed = resolveConsultationTarget(pendingGate.service, services);
    if (!routed) return;
    setConsultationOriginId(pendingGate.service.id);
    setSelectedServiceId(routed.target.id);
    setSelectedTime(null);
    setPendingGateId(null);
    setStep('STYLIST');
  };

  const renderStepIndicator = () => (
    <div className="flex justify-center mb-8 space-x-2" aria-hidden="true">
      {STEPS.map((s, idx) => (
        <div
          key={s}
          className={`h-2 w-8 sm:w-12 rounded-full ${
            STEPS.indexOf(step) >= idx || isSubmitted
              ? 'bg-zinc-900'
              : 'bg-gray-200'
          }`}
        />
      ))}
    </div>
  );

  const dayLabel = (day: string, options: Intl.DateTimeFormatOptions) => formatCalendarDay(locale, day, options);

  const priceSource = activeQuote ?? (selectedService ? {
    amountPence: selectedService.amountPence,
    priceType: selectedService.priceType,
    vatDisplay: selectedService.vatDisplay,
    priceNature: selectedService.priceNature,
  } : null);

  if (isSubmitted) {
    return (
      <div className="text-center py-12 animate-fade-in">
        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-3xl font-serif mb-4 text-zinc-900">{t('done.title')}</h2>
        <p className="text-zinc-700 mb-8">
          {t('done.body')}
        </p>
        <Link
          href="/appointments"
          onClick={() => {
            // The request is made; a later visit to /book starts fresh.
            for (const key of ['step', 'service', 'stylist', 'day', 'time', 'origin', 'gate', 'offering', 'option', 'search', 'category', 'submitted', 'reprice']) clearDraft(`${DRAFT}:${key}`);
          }}
          className="bg-zinc-900 text-white px-8 py-3 uppercase tracking-widest text-sm hover:bg-black rounded-md transition-colors"
        >
          {t('done.viewBookings')}
        </Link>
      </div>
    );
  }

  const renderOfferingEntry = (offering: ClientOffering, options: ClientService[]) => {
    const isOpen = openOfferingId === offering.id;
    const standard = options.filter((option) => option.priceType !== 'NHS').map((option) => option.amountPence);
    const needsConsultation = options.some((option) => option.requiresConsultation);
    const chosen = pendingOptionId ? options.find((option) => option.id === pendingOptionId) : undefined;
    return (
      <div key={offering.id} className={`border rounded-lg shadow-sm transition-all ${isOpen ? 'border-zinc-900' : 'border-zinc-200 hover:border-zinc-400'}`}>
        <button
          type="button"
          onClick={() => { setOpenOfferingId(isOpen ? null : offering.id); setPendingOptionId(null); }}
          aria-expanded={isOpen}
          className="w-full p-4 sm:p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center text-left hover:bg-zinc-50 rounded-lg"
        >
          <div className="mb-2 sm:mb-0">
            <h3 className="font-medium text-zinc-900 text-lg" lang={offering.translated ? undefined : 'en'}>{offering.name}</h3>
            {needsConsultation && (
              <span className="inline-block mt-1 text-[11px] uppercase tracking-wider font-semibold text-zinc-700 bg-zinc-100 border border-zinc-300 rounded px-2 py-0.5">
                {t('service.consultationRequired')}
              </span>
            )}
            {offering.description && (
              <p className="text-sm text-zinc-500 mt-1 hidden sm:block" lang={offering.translated ? undefined : 'en'}>{offering.description}</p>
            )}
          </div>
          {standard.length > 0 && (
            <span className="font-serif text-lg text-zinc-900 font-medium whitespace-nowrap">
              {Math.min(...standard) === Math.max(...standard)
                ? formatPrice(standard[0])
                : tp('range', { min: formatPrice(Math.min(...standard)), max: formatPrice(Math.max(...standard)) })}
            </span>
          )}
        </button>
        {isOpen && (
          <fieldset className="border-t border-zinc-200 p-4 sm:p-6">
            <legend className="sr-only">{t('service.chooseOption')}</legend>
            <p className="text-sm font-medium text-zinc-700 mb-3" aria-hidden="true">{t('service.chooseOption')}</p>
            <div className="grid gap-2">
              {options.map((option) => {
                const selectable = isSelectable(option);
                const base = option.surchargeBaseServiceId ? serviceById.get(option.surchargeBaseServiceId) : undefined;
                return (
                  <label
                    key={option.id}
                    className={`flex items-start justify-between gap-4 rounded-lg border p-3 ${selectable ? 'cursor-pointer hover:border-zinc-400' : 'opacity-60'} ${pendingOptionId === option.id ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200'}`}
                  >
                    <span className="flex items-start gap-3">
                      <input
                        type="radio"
                        name={`option-${offering.id}`}
                        value={option.id}
                        checked={pendingOptionId === option.id}
                        disabled={!selectable}
                        onChange={() => setPendingOptionId(option.id)}
                        className="mt-1 accent-zinc-900"
                      />
                      <span>
                        <span className="block text-sm font-medium text-zinc-900">
                          {option.hairLength ? <OptionLabel option={option} /> : tp.dynamic(`priceType.${option.priceType}`)}
                          {option.hairLength && option.priceType === 'NHS' && <> · {tp('columns.nhs')}</>}
                        </span>
                        <span className="block text-xs text-zinc-500"><Duration option={option} /></span>
                        {!selectable && <span className="block text-xs text-zinc-600 mt-1">{t('service.notBookable')}</span>}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-serif text-base text-zinc-900 tabular-nums">{formatPrice(option.amountPence)}</span>
                      <PriceFinePrint service={option} showNhs />
                      <SurchargeBreakdown option={option} base={base} />
                    </span>
                  </label>
                );
              })}
            </div>
            <button
              type="button"
              disabled={!chosen || !isSelectable(chosen)}
              onClick={() => chosen && handleSelectService(chosen)}
              className="mt-4 bg-zinc-900 text-white px-6 py-2.5 rounded-lg uppercase text-sm font-bold tracking-wider hover:bg-black disabled:opacity-50 transition-colors"
            >
              {t('service.select')}
            </button>
          </fieldset>
        )}
      </div>
    );
  };

  const renderSingleEntry = (service: ClientService) => (
    <button
      type="button"
      key={service.id}
      onClick={() => handleSelectService(service)}
      className="w-full text-left border border-zinc-200 p-4 sm:p-6 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center hover:border-zinc-400 hover:bg-zinc-50 cursor-pointer transition-all group shadow-sm hover:shadow-md"
    >
      <div className="mb-2 sm:mb-0">
        <h3 className="font-medium text-zinc-900 group-hover:text-zinc-900 transition-colors text-lg" lang={service.translated ? undefined : 'en'}>{service.name}</h3>
        {service.requiresConsultation && (
          <span className="inline-block mt-1 text-[11px] uppercase tracking-wider font-semibold text-zinc-700 bg-zinc-100 border border-zinc-300 rounded px-2 py-0.5">
            {t('service.consultationRequired')}
          </span>
        )}
        <div className="flex items-center gap-3 mt-1">
          <span className="text-sm text-zinc-600 flex items-center gap-1">
            <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <Duration option={service} />
          </span>
          {service.description && (
            <span className="text-sm text-zinc-500 hidden sm:inline-block border-l border-zinc-300 pl-3" lang={service.translated ? undefined : 'en'}>
              {service.description}
            </span>
          )}
        </div>
      </div>
      <span className="text-right">
        <span className="block font-serif text-xl text-zinc-900 font-medium whitespace-nowrap">{formatPrice(service.amountPence)}</span>
        <PriceFinePrint service={service} showNhs />
      </span>
    </button>
  );

  return (
    <div className="max-w-4xl mx-auto bg-white shadow-xl p-4 sm:p-6 md:p-8 md:min-h-[600px] rounded-xl border border-zinc-100">
      {renderStepIndicator()}

      <div className="mb-8">
        <h2 className="text-2xl font-serif mb-2 text-zinc-900">{t.dynamic(`steps.${step}`)}</h2>
        <p className="text-zinc-600 text-sm">
          {t('steps.progress', { current: STEPS.indexOf(step) + 1, total: STEPS.length })}
        </p>
      </div>

      {step === 'SERVICE' && (
        <div className="space-y-6">
          {pendingGate && (
            <div className="rounded-lg border border-zinc-300 bg-zinc-50 p-6">
              <h3 className="font-serif text-lg text-zinc-900 mb-2">{displayName(pendingGate.service)}</h3>
              {pendingGate.hasTarget ? (
                <>
                  <p className="text-sm text-zinc-700">
                    {t('gate.byConsultation', { fee: pendingGate.fee > 0 ? formatPrice(pendingGate.fee) : t('gate.freeFee') })}
                  </p>
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={confirmConsultation}
                      className="bg-zinc-900 text-white px-6 py-2.5 rounded-lg uppercase text-sm font-bold tracking-wider hover:bg-black transition-colors"
                    >
                      {t('gate.bookConsultation')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingGateId(null)}
                      className="text-sm font-medium text-zinc-600 hover:text-zinc-900 px-3"
                    >
                      {t('gate.back')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-zinc-700">
                    {t('gate.consultationOnly')}
                  </p>
                  <button
                    type="button"
                    onClick={() => setPendingGateId(null)}
                    className="mt-4 text-sm font-medium text-zinc-600 hover:text-zinc-900"
                  >
                    {t('gate.backToServices')}
                  </button>
                </>
              )}
            </div>
          )}
          <div className="flex flex-col md:flex-row gap-4">
             {/* Category Dropdown */}
             <div className="md:w-1/3">
                <label htmlFor="booking-category" className="block text-sm font-medium text-zinc-700 mb-2">{t('service.category')}</label>
                <div className="relative">
                   <select
                      id="booking-category"
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="block w-full pl-4 pr-10 py-3 border border-zinc-300 rounded-lg leading-5 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900 transition-all appearance-none text-zinc-900"
                   >
                      {browsable.map(({ category }) => (
                         <option key={category} value={category}>{categoryLabel(category)}</option>
                      ))}
                   </select>
                   <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                      <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                   </div>
                </div>
             </div>

             {/* Search Bar */}
             <div className="md:w-2/3">
                <label htmlFor="booking-search" className="block text-sm font-medium text-zinc-700 mb-2">{t('service.search')}</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    id="booking-search"
                    type="search"
                    className="block w-full pl-10 pr-3 py-3 border border-zinc-300 rounded-lg leading-5 bg-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900 transition-all text-zinc-900"
                    placeholder={t('service.searchPlaceholder', { category: categoryLabel(selectedCategory) })}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
             </div>
          </div>

          <div className="space-y-3 mt-6">
             <h3 className="font-medium text-zinc-500 text-sm uppercase tracking-wider mb-3">{t('service.available')}</h3>
            {visibleEntries.length > 0 ? (
              <div className="grid gap-4">
                {visibleEntries.map((entry) => entry.kind === 'offering'
                  ? renderOfferingEntry(entry.offering, entry.options)
                  : renderSingleEntry(entry.service))}
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-500 bg-zinc-50 rounded-lg border border-zinc-100 border-dashed">
                <p>{t('service.noResults', { category: categoryLabel(selectedCategory), term: searchTerm })}</p>
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="mt-2 text-zinc-700 underline text-sm hover:text-zinc-900"
                >
                  {t('service.clearSearch')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'STYLIST' && (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-6 mb-8">
            <button
              type="button"
              onClick={() => { setSelectedStylistId(ANY_STYLIST_ID); setSelectedTime(null); setStep('DATE'); }}
              className="border border-dashed border-zinc-300 p-4 sm:p-6 rounded-lg text-center hover:border-zinc-400 hover:bg-zinc-50 cursor-pointer transition-all shadow-sm group"
            >
              <div className="w-16 h-16 sm:w-24 sm:h-24 bg-zinc-100 rounded-full mx-auto mb-4 flex items-center justify-center ring-2 ring-offset-2 ring-transparent group-hover:ring-zinc-900 transition-all">
                <svg className="w-10 h-10 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-3-3" />
                </svg>
              </div>
              <h3 className="font-medium text-zinc-900 text-lg">{t('stylist.anyone')}</h3>
              <p className="text-sm text-zinc-600 mt-1">{t('stylist.firstAvailable')}</p>
            </button>
            {stylists.map(stylist => (
              <button
                type="button"
                key={stylist.id}
                onClick={() => { setSelectedStylistId(stylist.id); setSelectedTime(null); setStep('DATE'); }}
                className="border border-zinc-200 p-4 sm:p-6 rounded-lg text-center hover:border-zinc-400 hover:bg-zinc-50 cursor-pointer transition-all shadow-sm group"
              >
                 <div className="w-16 h-16 sm:w-24 sm:h-24 bg-zinc-200 rounded-full mx-auto mb-4 overflow-hidden ring-2 ring-offset-2 ring-transparent group-hover:ring-zinc-900 transition-all">
                   {stylist.imageUrl ? (
                     // eslint-disable-next-line @next/next/no-img-element
                     <img src={stylist.imageUrl} alt={stylist.name} className="w-full h-full object-cover" />
                   ) : (
                     <div className="w-full h-full flex items-center justify-center text-2xl font-serif text-zinc-400 bg-zinc-100" aria-hidden="true">
                       {stylist.name.charAt(0)}
                     </div>
                   )}
                 </div>
                <h3 className="font-medium text-zinc-900 text-lg">{stylist.name}</h3>
                <p className="text-sm text-zinc-600 mt-1">{stylist.role}</p>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setPendingGateId(null); setConsultationOriginId(null); setStep('SERVICE'); }} className="text-sm font-medium text-zinc-600 hover:text-zinc-900 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {t('stylist.backToServices')}
          </button>
        </div>
      )}

      {step === 'DATE' && (
        <div className="animate-in slide-in-from-right-4 duration-300">
          <div className="flex flex-col lg:flex-row gap-8 mb-8 h-full">
            {/* Date Selection - Sticky Sidebar on Desktop */}
            <div className="lg:w-1/3">
              <h3 className="font-medium mb-4 text-zinc-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-zinc-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {t('date.selectDate')}
              </h3>
              <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200">
                <div className="flex lg:flex-col space-x-3 lg:space-x-0 lg:space-y-3 overflow-x-auto lg:overflow-visible snap-x snap-mandatory lg:snap-none pb-4 lg:pb-0 scrollbar-thin scrollbar-thumb-zinc-300 scrollbar-track-transparent">
                  {days.map((day) => (
                    <DayChip
                      key={day}
                      weekday={dayLabel(day, { weekday: 'short' })}
                      dayOfMonth={Number(day.slice(8, 10))}
                      month={dayLabel(day, { month: 'short' })}
                      fullLabel={dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}
                      selected={day === selectedDay}
                      unavailable={!daysLoading && isUnavailable(day)}
                      onSelect={() => { setSelectedDay(day); setSelectedTime(null); }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Time Selection - Main Area */}
            <div className="lg:w-2/3">
              <h3 className="font-medium mb-4 text-zinc-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-zinc-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t('date.availableTimes')}
              </h3>

              {daysLoading ? (
                <div className="flex flex-col items-center justify-center h-64 text-zinc-500 text-sm bg-zinc-50 rounded-xl border border-zinc-100" role="status">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900 mb-3" aria-hidden="true"></div>
                  {t('date.checking')}
                </div>
              ) : dayInfo?.status === 'OPEN' ? (
                <TimeSlotGrid slots={dayInfo.slots} selectedTime={selectedTime} onSelect={setSelectedTime} />
              ) : dayInfo?.status === 'UNAVAILABLE' && !slotLoadFailed ? (
                <UnavailableDayBlock hours={dayInfo.hours} stylistName={selectedStylistId === ANY_STYLIST_ID ? null : selectedStylist?.name ?? null} />
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-zinc-600 bg-zinc-50 rounded-xl border border-zinc-200 border-dashed text-center p-6">
                  <svg className="w-12 h-12 text-zinc-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="font-medium">{slotLoadFailed ? t('date.loadFailed') : t('date.noneAvailable')}</p>
                  <p className="text-sm text-zinc-500 mt-1">{slotLoadFailed ? t('date.loadFailedHelp') : t('date.noneAvailableHelp')}</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-between items-center pt-6 border-t border-zinc-100 sticky bottom-0 bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))] z-10">
             <button type="button" onClick={() => setStep('STYLIST')} className="text-sm font-medium text-zinc-600 hover:text-zinc-900 flex items-center gap-1 px-3 py-2 rounded-md hover:bg-zinc-50 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {tc('actions.back')}
             </button>
             <div className="flex flex-col items-end">
               {selectedTime && (
                 <span className="text-xs text-zinc-500 mb-1 hidden sm:block">
                   {t('date.selectedAt', { date: dayLabel(selectedDay, { day: 'numeric', month: 'short' }), time: selectedTime })}
                 </span>
               )}
               <button
                 type="button"
                 disabled={!selectedTime}
                 onClick={() => setStep('CONFIRM')}
                 className="bg-zinc-900 text-white px-8 py-3 rounded-lg uppercase text-sm font-bold tracking-wider hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md transform active:scale-95"
               >
                 {tc('actions.continue')}
               </button>
             </div>
          </div>
        </div>
      )}

      {step === 'CONFIRM' && selectedService && (
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="bg-zinc-50/50 p-6 rounded-xl border border-zinc-200 shadow-sm">
            <h3 className="font-serif text-lg mb-4 pb-2 border-b border-zinc-200 text-zinc-900">{t('confirm.summary')}</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 text-sm">
              <div>
                <dt className="text-zinc-500 uppercase text-xs tracking-wider font-semibold block mb-1">{t('confirm.service')}</dt>
                <dd className="text-zinc-900 font-medium text-base">{displayName(selectedService)}</dd>
              </div>
              {consultationOrigin && (
                <div className="sm:col-span-2">
                  <dt className="text-zinc-500 uppercase text-xs tracking-wider font-semibold block mb-1">{t('confirm.consultationFor')}</dt>
                  <dd className="text-zinc-900 font-medium text-base">{displayName(consultationOrigin)}</dd>
                </div>
              )}
              <div>
                <dt className="text-zinc-500 uppercase text-xs tracking-wider font-semibold block mb-1">{t('confirm.stylist')}</dt>
                <dd className="text-zinc-900 font-medium text-base">{selectedStylist?.name}</dd>
              </div>
              <div>
                <dt className="text-zinc-500 uppercase text-xs tracking-wider font-semibold block mb-1">{t('confirm.date')}</dt>
                <dd className="text-zinc-900 font-medium text-base">{dayLabel(selectedDay, { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
              </div>
              <div>
                <dt className="text-zinc-500 uppercase text-xs tracking-wider font-semibold block mb-1">{t('confirm.time')}</dt>
                <dd className="text-zinc-900 font-medium text-base">{selectedTime}</dd>
              </div>
              {priceSource && (
                <div className="sm:col-span-2 border-t border-zinc-200 pt-4 mt-2">
                  <div className="flex justify-between items-start gap-4">
                    <dt className="text-zinc-600 font-medium">{t('confirm.totalPrice')}</dt>
                    <dd className="text-right">
                      <span className="block text-xl font-bold text-zinc-900 tabular-nums">{formatPrice(priceSource.amountPence)}</span>
                      {priceSource.priceType === 'NHS' && (
                        <span className="inline-block mt-1 text-xs bg-zinc-100 text-zinc-800 px-2 py-1 rounded-md font-medium border border-zinc-200">
                          {tp('nhsApplied')}
                        </span>
                      )}
                      <PriceFinePrint service={priceSource} className="mt-1" />
                    </dd>
                  </div>
                </div>
              )}
            </dl>
          </div>

          {colourGate && !colourGate.eligible && (
            <div className="rounded-lg border border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-700">
              <p className="font-medium">{t('confirm.patchTestTitle')}</p>
              <p className="mt-1">
                {colourGate.reason === 'expired' ? t('confirm.patchTestExpired') : t('confirm.patchTestBody')}
              </p>
              <button
                type="button"
                onClick={() => {
                  const test = services.find((s) => s.isPatchTest);
                  if (test) {
                    setSelectedServiceId(test.id);
                    setSelectedTime(null);
                    setStep('DATE');
                  }
                }}
                className="mt-3 rounded bg-zinc-900 px-3 py-1.5 text-white hover:bg-black"
              >
                {t('confirm.bookPatchTestFirst')}
              </button>
            </div>
          )}

          {bookingError && (
            <div className="p-4 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200" role="alert">
              {bookingError}
            </div>
          )}

          <div className="flex justify-between items-center pt-6 border-t border-zinc-100">
             <button type="button" onClick={() => setStep('DATE')} className="text-sm font-medium text-zinc-600 hover:text-zinc-900 flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {tc('actions.back')}
             </button>
             <button
               type="submit"
               disabled={isLoading || (colourGate !== null && !colourGate.eligible)}
               className="bg-zinc-900 text-white px-8 py-3.5 rounded-lg uppercase text-sm font-bold tracking-wider hover:bg-black disabled:opacity-70 disabled:cursor-not-allowed shadow-md transition-all transform hover:-translate-y-0.5"
             >
               {isLoading ? (
                 <span className="flex items-center gap-2">
                   <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" aria-hidden="true"></span>
                   {t('confirm.processing')}
                 </span>
               ) : activeQuote ? t('confirm.confirmNewPrice') : t('confirm.confirmBooking')}
             </button>
          </div>
        </form>
      )}
    </div>
  );
}

