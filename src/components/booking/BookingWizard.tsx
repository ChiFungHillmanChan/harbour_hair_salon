'use client';

import { Service, Stylist } from '@prisma/client';
import { format, addDays, startOfToday, isSameDay } from 'date-fns';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { fetchSlots, submitBooking, validateDiscountCode } from '@/app/actions/booking';
import { ANY_STYLIST_ID } from '@/app/lib/booking-constants';
import { resolveConsultationTarget } from '@/app/services/consultation-routing';
import { applyOfferToPrice, type ActiveOffer } from '@/app/services/offer-pricing';

// Define a ClientService type where price is number instead of Decimal
type ClientService = Omit<Service, 'price'> & { price: number };

// A named stylist or the synthetic "Anyone / first available" option.
type SelectedStylist = Pick<Stylist, 'id' | 'name' | 'role'>;

// Only the public-safe fields the page passes down (never the full Stylist row,
// which carries the secret treatwellIcalUrl).
type PublicStylist = Pick<Stylist, 'id' | 'name' | 'role' | 'imageUrl'>;

type Step = 'SERVICE' | 'STYLIST' | 'DATE' | 'CONFIRM';

interface BookingWizardProps {
  services: ClientService[];
  stylists: PublicStylist[];
  /** The live site-wide offer, so the wizard charges/shows what the public pages advertise. */
  activeOffer?: ActiveOffer;
}

const CATEGORIES = [
  'Haircuts',
  'Colouring',
  'Perms',
  'Treatments',
  'Styling'
];

export function BookingWizard({ services, stylists, activeOffer = null }: BookingWizardProps) {
  const [step, setStep] = useState<Step>('SERVICE');
  const [selectedService, setSelectedService] = useState<ClientService | null>(null);
  const [selectedStylist, setSelectedStylist] = useState<SelectedStylist | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  // True when the last slot lookup failed (vs a genuinely empty day) — lets us
  // show "couldn't load times" instead of implying the salon is fully booked.
  const [slotLoadFailed, setSlotLoadFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  // Set when the customer picked a consultation-gated service. Holds the ORIGINAL
  // service so we can label the consultation and record intent on submit.
  const [consultationOrigin, setConsultationOrigin] = useState<ClientService | null>(null);
  // The gate panel for the service the customer just clicked (before they confirm).
  const [pendingGate, setPendingGate] = useState<{ service: ClientService; fee: number; hasTarget: boolean } | null>(null);

  // Colour patch-test gate: populated when a colour service + date are selected
  const [colourGate, setColourGate] = useState<{ eligible: boolean; reason: string; testDate: string | null } | null>(null);

  // Search and Category Logic
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Haircuts');

  // Discount Logic
  const [discountCode, setDiscountCode] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState<{ code: string; value: number; type: string } | null>(null);
  const [discountError, setDiscountError] = useState('');
  const [isValidatingDiscount, setIsValidatingDiscount] = useState(false);

  // Fetch slots when stylist or date changes
  useEffect(() => {
    if (selectedStylist && selectedDate && selectedService) {
      let cancelled = false;
      const loadSlots = async () => {
        setIsLoading(true);
        setSlotLoadFailed(false);
        // Reset selected time when date/stylist changes
        setSelectedTime(null);
        try {
          const result = await fetchSlots(selectedStylist.id, format(selectedDate, 'yyyy-MM-dd'), selectedService.duration);
          // Ignore a response that arrived after the inputs changed (out-of-order guard)
          if (cancelled) return;
          if (result.ok) {
            setAvailableSlots(result.slots.filter(s => s.available).map(s => s.time));
          } else {
            setAvailableSlots([]);
            setSlotLoadFailed(true);
          }
        } catch {
          if (cancelled) return;
          setAvailableSlots([]);
          setSlotLoadFailed(true);
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      };
      loadSlots();
      return () => { cancelled = true; };
    }
  }, [selectedStylist, selectedDate, selectedService]);

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
      const res = await checkColourEligibility(selectedService.id, format(selectedDate, 'yyyy-MM-dd'));
      if (!cancelled) {
        setColourGate({ eligible: res.eligible, reason: res.reason, testDate: res.testDate });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedService, selectedDate]);

  const handleApplyDiscount = async () => {
    if (!discountCode.trim()) return;
    setDiscountError('');
    setIsValidatingDiscount(true);

    try {
      const result = await validateDiscountCode(discountCode);

      if (result.valid) {
        setAppliedDiscount({
          code: discountCode,
          value: result.value!,
          type: result.type!,
        });
        setDiscountError('');
      } else {
        setAppliedDiscount(null);
        setDiscountError(result.error || 'Invalid code');
      }
    } catch {
      setAppliedDiscount(null);
      setDiscountError('Could not check that code. Please try again.');
    } finally {
      setIsValidatingDiscount(false);
    }
  };

  const getFinalPrice = () => {
    if (!selectedService) return 0;
    // Start from the site-wide offer price (what the public pages advertise and
    // what the server records as priceAtBooking), then apply any discount code.
    const originalPrice = applyOfferToPrice(selectedService.price, activeOffer);
    return applyOfferToPrice(originalPrice, appliedDiscount
      ? { discountType: appliedDiscount.type, discountValue: appliedDiscount.value }
      : null);
  };

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
        date: format(selectedDate, 'yyyy-MM-dd'),
        time: selectedTime,
        discountCode: appliedDiscount?.code,
        consultationForServiceId: consultationOrigin?.id,
      });

      if (result.success) {
        setIsSubmitted(true);
      } else {
        setBookingError(result.error || 'Booking failed. Please try again.');
      }
    } catch {
      // A rejected action (dropped connection, DB error) must not leave the
      // button stuck on "Processing…" — surface a message and re-enable it.
      setBookingError('Something went wrong. Please try again, or call the salon.');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredServices = services.filter(service => {
    if (service.isConsultation || service.isPatchTest) return false; // reached via routing, not browsed
    const matchesSearch = service.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = service.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Called when a service card is clicked. Gated services open the consultation
  // gate instead of proceeding straight to stylist selection.
  const handleSelectService = (service: ClientService) => {
    if (service.requiresConsultation) {
      const routed = resolveConsultationTarget(service, services);
      setPendingGate({ service, fee: routed?.fee ?? 0, hasTarget: routed !== null });
      return;
    }
    setPendingGate(null);
    setConsultationOrigin(null);
    setSelectedService(service);
    setStep('STYLIST');
  };

  // Confirm the gate: swap to the consultation target and continue the flow.
  const confirmConsultation = () => {
    if (!pendingGate) return;
    const routed = resolveConsultationTarget(pendingGate.service, services);
    if (!routed) return;
    setConsultationOrigin(pendingGate.service);
    setSelectedService(routed.target);
    setPendingGate(null);
    setStep('STYLIST');
  };

  // Helper to group slots by time of day
  const getGroupedSlots = () => {
    const morning: string[] = [];
    const afternoon: string[] = [];
    const evening: string[] = [];

    availableSlots.forEach(time => {
      const hour = parseInt(time.split(':')[0]);
      if (hour < 12) morning.push(time);
      else if (hour < 17) afternoon.push(time);
      else evening.push(time);
    });

    return { morning, afternoon, evening };
  };

  const STEPS: Step[] = ['SERVICE', 'STYLIST', 'DATE', 'CONFIRM'];

  const renderStepIndicator = () => (
    <div className="flex justify-center mb-8 space-x-2">
      {STEPS.map((s, idx) => (
        <div
          key={s}
          className={`h-2 w-8 sm:w-12 rounded-full ${
            STEPS.indexOf(step as Step) >= idx || isSubmitted
              ? 'bg-zinc-900'
              : 'bg-gray-200'
          }`}
        />
      ))}
    </div>
  );

  const groupedSlots = getGroupedSlots();
  const hasAnySlots = availableSlots.length > 0;

  if (isSubmitted) {
    return (
      <div className="text-center py-12 animate-fade-in">
        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-3xl font-serif mb-4 text-zinc-900">Booking Request Received!</h2>
        <p className="text-zinc-700 mb-8">
          Your request has been sent to the salon. We&apos;ll email you as soon as it&apos;s confirmed.
        </p>
        <Link
          href="/appointments"
          className="bg-zinc-900 text-white px-8 py-3 uppercase tracking-widest text-sm hover:bg-black rounded-md transition-colors"
        >
          View My Bookings
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto bg-white shadow-xl p-4 sm:p-6 md:p-8 md:min-h-[600px] rounded-xl border border-zinc-100">
      {renderStepIndicator()}

      <div className="mb-8">
        <h2 className="text-2xl font-serif mb-2 text-zinc-900">
          {step === 'SERVICE' && 'Select a Service'}
          {step === 'STYLIST' && 'Choose a Stylist'}
          {step === 'DATE' && 'Select Date & Time'}
          {step === 'CONFIRM' && 'Review & Confirm'}
        </h2>
        <p className="text-zinc-600 text-sm">
          Step {STEPS.indexOf(step as Step) + 1} of {STEPS.length}
        </p>
      </div>

      {step === 'SERVICE' && (
        <div className="space-y-6">
          {pendingGate && (
            <div className="rounded-lg border border-zinc-300 bg-zinc-50 p-6">
              <h3 className="font-serif text-lg text-zinc-900 mb-2">{pendingGate.service.name}</h3>
              {pendingGate.hasTarget ? (
                <>
                  <p className="text-sm text-zinc-700">
                    This service is by consultation. We&apos;ll book you a{' '}
                    {pendingGate.fee > 0 ? `£${pendingGate.fee.toFixed(2)}` : 'free'} consultation to discuss it,
                    then arrange the service with you.
                  </p>
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={confirmConsultation}
                      className="bg-zinc-900 text-white px-6 py-2.5 rounded-lg uppercase text-sm font-bold tracking-wider hover:bg-black transition-colors"
                    >
                      Book a Consultation
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingGate(null)}
                      className="text-sm font-medium text-zinc-600 hover:text-zinc-900 px-3"
                    >
                      Back
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-zinc-700">
                    This service is by consultation only. Please contact the salon to arrange it.
                  </p>
                  <button
                    type="button"
                    onClick={() => setPendingGate(null)}
                    className="mt-4 text-sm font-medium text-zinc-600 hover:text-zinc-900"
                  >
                    Back to services
                  </button>
                </>
              )}
            </div>
          )}
          <div className="flex flex-col md:flex-row gap-4">
             {/* Category Dropdown */}
             <div className="md:w-1/3">
                <label className="block text-sm font-medium text-zinc-700 mb-2">Category</label>
                <div className="relative">
                   <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="block w-full pl-4 pr-10 py-3 border border-zinc-300 rounded-lg leading-5 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900 transition-all appearance-none text-zinc-900"
                   >
                      {CATEGORIES.map(category => (
                         <option key={category} value={category}>{category}</option>
                      ))}
                   </select>
                   <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                      <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                   </div>
                </div>
             </div>

             {/* Search Bar */}
             <div className="md:w-2/3">
                <label className="block text-sm font-medium text-zinc-700 mb-2">Search</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    className="block w-full pl-10 pr-3 py-3 border border-zinc-300 rounded-lg leading-5 bg-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900 transition-all text-zinc-900"
                    placeholder={`Search in ${selectedCategory}...`}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
             </div>
          </div>

          <div className="space-y-3 mt-6">
             <h3 className="font-medium text-zinc-500 text-sm uppercase tracking-wider mb-3">Available Services</h3>
            {filteredServices.length > 0 ? (
              <div className="grid gap-4">
                {filteredServices.map(service => (
                  <div
                    key={service.id}
                    onClick={() => handleSelectService(service)}
                    className="border border-zinc-200 p-4 sm:p-6 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center hover:border-zinc-400 hover:bg-zinc-50 cursor-pointer transition-all group shadow-sm hover:shadow-md"
                  >
                    <div className="mb-2 sm:mb-0">
                      <h3 className="font-medium text-zinc-900 group-hover:text-zinc-900 transition-colors text-lg">{service.name}</h3>
                      {service.requiresConsultation && (
                        <span className="inline-block mt-1 text-[11px] uppercase tracking-wider font-semibold text-zinc-700 bg-zinc-100 border border-zinc-300 rounded px-2 py-0.5">
                          Consultation required
                        </span>
                      )}
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-sm text-zinc-600 flex items-center gap-1">
                           <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                           </svg>
                           {service.duration} mins
                        </span>
                        {service.description && (
                           <span className="text-sm text-zinc-500 hidden sm:inline-block border-l border-zinc-300 pl-3">
                              {service.description}
                           </span>
                        )}
                      </div>
                    </div>
                    {activeOffer ? (
                      <span className="font-serif text-xl text-zinc-900 font-medium whitespace-nowrap">
                        <span className="line-through text-zinc-400 text-base mr-2">£{service.price.toFixed(2)}</span>
                        £{applyOfferToPrice(service.price, activeOffer).toFixed(2)}
                      </span>
                    ) : (
                      <span className="font-serif text-xl text-zinc-900 font-medium whitespace-nowrap">£{service.price.toFixed(2)}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-500 bg-zinc-50 rounded-lg border border-zinc-100 border-dashed">
                <p>No services found in <span className="font-semibold">{selectedCategory}</span> matching &quot;{searchTerm}&quot;</p>
                <button
                  onClick={() => setSearchTerm('')}
                  className="mt-2 text-zinc-700 underline text-sm hover:text-zinc-900"
                >
                  Clear search
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
              onClick={() => { setSelectedStylist({ id: ANY_STYLIST_ID, name: 'Anyone', role: 'First available' }); setStep('DATE'); }}
              className="border border-dashed border-zinc-300 p-4 sm:p-6 rounded-lg text-center hover:border-zinc-400 hover:bg-zinc-50 cursor-pointer transition-all shadow-sm group"
            >
              <div className="w-16 h-16 sm:w-24 sm:h-24 bg-zinc-100 rounded-full mx-auto mb-4 flex items-center justify-center ring-2 ring-offset-2 ring-transparent group-hover:ring-zinc-900 transition-all">
                <svg className="w-10 h-10 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-3-3" />
                </svg>
              </div>
              <h3 className="font-medium text-zinc-900 text-lg">Anyone</h3>
              <p className="text-sm text-zinc-600 mt-1">First available</p>
            </button>
            {stylists.map(stylist => (
              <div
                key={stylist.id}
                onClick={() => { setSelectedStylist(stylist); setStep('DATE'); }}
                className="border border-zinc-200 p-4 sm:p-6 rounded-lg text-center hover:border-zinc-400 hover:bg-zinc-50 cursor-pointer transition-all shadow-sm group"
              >
                 <div className="w-16 h-16 sm:w-24 sm:h-24 bg-zinc-200 rounded-full mx-auto mb-4 overflow-hidden ring-2 ring-offset-2 ring-transparent group-hover:ring-zinc-900 transition-all">
                   {stylist.imageUrl ? (
                     // eslint-disable-next-line @next/next/no-img-element
                     <img src={stylist.imageUrl} alt={stylist.name} className="w-full h-full object-cover" />
                   ) : (
                     <div className="w-full h-full flex items-center justify-center text-2xl font-serif text-zinc-400 bg-zinc-100">
                       {stylist.name.charAt(0)}
                     </div>
                   )}
                 </div>
                <h3 className="font-medium text-zinc-900 text-lg">{stylist.name}</h3>
                <p className="text-sm text-zinc-600 mt-1">{stylist.role}</p>
              </div>
            ))}
          </div>
          <button onClick={() => { setPendingGate(null); setConsultationOrigin(null); setStep('SERVICE'); }} className="text-sm font-medium text-zinc-600 hover:text-zinc-900 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Services
          </button>
        </div>
      )}

      {step === 'DATE' && (
        <div className="animate-in slide-in-from-right-4 duration-300">
          <div className="flex flex-col lg:flex-row gap-8 mb-8 h-full">
            {/* Date Selection - Sticky Sidebar on Desktop */}
            <div className="lg:w-1/3">
              <h3 className="font-medium mb-4 text-zinc-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-zinc-900" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Select Date
              </h3>
              <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200">
                <div className="flex lg:flex-col space-x-3 lg:space-x-0 lg:space-y-3 overflow-x-auto lg:overflow-visible snap-x snap-mandatory lg:snap-none pb-4 lg:pb-0 scrollbar-thin scrollbar-thumb-zinc-300 scrollbar-track-transparent">
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(offset => {
                    const date = addDays(startOfToday(), offset);
                    const isSelected = isSameDay(date, selectedDate);
                    return (
                      <button
                        key={offset}
                        onClick={() => setSelectedDate(date)}
                        className={`flex-shrink-0 snap-start w-20 lg:w-full p-3 rounded-lg border flex lg:flex-row flex-col items-center lg:justify-between justify-center transition-all ${
                          isSelected
                            ? 'border-zinc-900 bg-zinc-900 text-white shadow-md'
                            : 'border-zinc-200 hover:border-zinc-400 hover:bg-white bg-white text-zinc-700'
                        }`}
                      >
                        <div className="text-center lg:text-left">
                          <span className={`text-xs uppercase font-bold block ${isSelected ? 'text-zinc-300' : 'text-zinc-500'}`}>
                            {format(date, 'EEE')}
                          </span>
                          <span className="text-lg font-bold block leading-tight">
                            {format(date, 'd')}
                          </span>
                        </div>
                        <span className={`text-xs ${isSelected ? 'text-zinc-400' : 'text-zinc-400'}`}>
                          {format(date, 'MMM')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Time Selection - Main Area */}
            <div className="lg:w-2/3">
              <h3 className="font-medium mb-4 text-zinc-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-zinc-900" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Available Times
              </h3>

              {isLoading ? (
                <div className="flex flex-col items-center justify-center h-64 text-zinc-500 text-sm bg-zinc-50 rounded-xl border border-zinc-100">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900 mb-3"></div>
                  Checking availability...
                </div>
              ) : hasAnySlots ? (
                <div className="space-y-6 animate-in fade-in duration-500">
                  {/* Morning Slots */}
                  {groupedSlots.morning.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-3 border-b border-zinc-100 pb-1">Morning</h4>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                        {groupedSlots.morning.map(time => (
                          <TimeSlotButton
                            key={time}
                            time={time}
                            isSelected={selectedTime === time}
                            onClick={() => setSelectedTime(time)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Afternoon Slots */}
                  {groupedSlots.afternoon.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-3 border-b border-zinc-100 pb-1">Afternoon</h4>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                        {groupedSlots.afternoon.map(time => (
                          <TimeSlotButton
                            key={time}
                            time={time}
                            isSelected={selectedTime === time}
                            onClick={() => setSelectedTime(time)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Evening Slots */}
                  {groupedSlots.evening.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-3 border-b border-zinc-100 pb-1">Evening</h4>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                        {groupedSlots.evening.map(time => (
                          <TimeSlotButton
                            key={time}
                            time={time}
                            isSelected={selectedTime === time}
                            onClick={() => setSelectedTime(time)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-zinc-600 bg-zinc-50 rounded-xl border border-zinc-200 border-dashed text-center p-6">
                  <svg className="w-12 h-12 text-zinc-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="font-medium">{slotLoadFailed ? "We couldn't load available times" : 'No appointments available'}</p>
                  <p className="text-sm text-zinc-500 mt-1">{slotLoadFailed ? 'Please try again in a moment, or call the salon to book.' : 'Please try selecting a different date or stylist.'}</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-between items-center pt-6 border-t border-zinc-100 sticky bottom-0 bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))] z-10">
             <button onClick={() => setStep('STYLIST')} className="text-sm font-medium text-zinc-600 hover:text-zinc-900 flex items-center gap-1 px-3 py-2 rounded-md hover:bg-zinc-50 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
             </button>
             <div className="flex flex-col items-end">
               {selectedTime && (
                 <span className="text-xs text-zinc-500 mb-1 hidden sm:block">
                   {format(selectedDate, 'MMM d')} at {selectedTime}
                 </span>
               )}
               <button
                 disabled={!selectedTime}
                 onClick={() => setStep('CONFIRM' as Step)}
                 className="bg-zinc-900 text-white px-8 py-3 rounded-lg uppercase text-sm font-bold tracking-wider hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md transform active:scale-95"
               >
                 Continue
               </button>
             </div>
          </div>
        </div>
      )}

      {step === 'CONFIRM' && (
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="bg-zinc-50/50 p-6 rounded-xl border border-zinc-200 shadow-sm">
            <h3 className="font-serif text-lg mb-4 pb-2 border-b border-zinc-200 text-zinc-900">Booking Summary</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 text-sm">
              <div>
                <span className="text-zinc-500 uppercase text-xs tracking-wider font-semibold block mb-1">Service</span>
                <span className="text-zinc-900 font-medium text-base">{selectedService?.name}</span>
              </div>
              {consultationOrigin && (
                <div className="sm:col-span-2">
                  <span className="text-zinc-500 uppercase text-xs tracking-wider font-semibold block mb-1">Consultation for</span>
                  <span className="text-zinc-900 font-medium text-base">{consultationOrigin.name}</span>
                </div>
              )}
              <div>
                <span className="text-zinc-500 uppercase text-xs tracking-wider font-semibold block mb-1">Stylist</span>
                <span className="text-zinc-900 font-medium text-base">{selectedStylist?.name}</span>
              </div>
              <div>
                <span className="text-zinc-500 uppercase text-xs tracking-wider font-semibold block mb-1">Date</span>
                <span className="text-zinc-900 font-medium text-base">{format(selectedDate, 'd MMMM yyyy')}</span>
              </div>
              <div>
                <span className="text-zinc-500 uppercase text-xs tracking-wider font-semibold block mb-1">Time</span>
                <span className="text-zinc-900 font-medium text-base">{selectedTime}</span>
              </div>
              <div className="sm:col-span-2 border-t border-zinc-200 pt-4 mt-2">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-600 font-medium">Total Price</span>
                  <div className="flex items-center gap-3">
                    {appliedDiscount || activeOffer ? (
                      <>
                        <span className="line-through text-zinc-400 text-sm">£{selectedService?.price.toFixed(2)}</span>
                        <span className="text-xl font-bold text-zinc-900">£{getFinalPrice().toFixed(2)}</span>
                        {appliedDiscount ? (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-md font-medium border border-green-200">
                            {appliedDiscount.code} applied
                          </span>
                        ) : (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-md font-medium border border-green-200">
                            Offer applied
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xl font-bold text-zinc-900">£{selectedService?.price.toFixed(2)}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Discount Code */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-700">Discount Code (Optional)</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                className="flex-1 border border-zinc-300 px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900/30 focus:border-zinc-900 transition-all uppercase bg-white text-zinc-900"
                placeholder="PROMO CODE"
                value={discountCode}
                onChange={e => setDiscountCode(e.target.value)}
                disabled={!!appliedDiscount}
              />
              {appliedDiscount ? (
                <button
                  type="button"
                  onClick={() => {
                    setAppliedDiscount(null);
                    setDiscountCode('');
                  }}
                  className="bg-zinc-100 text-zinc-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-200 border border-zinc-200 transition-colors"
                >
                  Remove
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleApplyDiscount}
                  disabled={isValidatingDiscount || !discountCode.trim()}
                  className="bg-zinc-900 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                >
                  {isValidatingDiscount ? '...' : 'Apply'}
                </button>
              )}
            </div>
            {discountError && <p className="text-red-600 text-xs mt-1.5">{discountError}</p>}
          </div>

          {colourGate && !colourGate.eligible && (
            <div className="rounded-lg border border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-700">
              <p className="font-medium">Consultation &amp; Patch Test required</p>
              <p className="mt-1">
                Colour services need a completed consultation &amp; patch test at least 48 hours beforehand
                {colourGate.reason === 'expired' ? ' (your previous test has expired)' : ''}.
              </p>
              <button
                type="button"
                onClick={() => {
                  const test = services.find((s) => s.isPatchTest);
                  if (test) {
                    setSelectedService(test);
                    setSelectedTime(null);
                    setStep('DATE');
                  }
                }}
                className="mt-3 rounded bg-zinc-900 px-3 py-1.5 text-white hover:bg-black"
              >
                Book Consultation &amp; Patch Test first
              </button>
            </div>
          )}

          {bookingError && (
            <div className="p-4 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
              {bookingError}
            </div>
          )}

          <div className="flex justify-between items-center pt-6 border-t border-zinc-100">
             <button type="button" onClick={() => setStep('DATE')} className="text-sm font-medium text-zinc-600 hover:text-zinc-900 flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
             </button>
             <button
               type="submit"
               disabled={isLoading || (colourGate !== null && !colourGate.eligible)}
               className="bg-zinc-900 text-white px-8 py-3.5 rounded-lg uppercase text-sm font-bold tracking-wider hover:bg-black disabled:opacity-70 disabled:cursor-not-allowed shadow-md transition-all transform hover:-translate-y-0.5"
             >
               {isLoading ? (
                 <span className="flex items-center gap-2">
                   <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                   Processing...
                 </span>
               ) : 'Confirm Booking'}
             </button>
          </div>
        </form>
      )}
    </div>
  );
}

function TimeSlotButton({ time, isSelected, onClick }: { time: string; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-[44px] py-3 px-2 text-sm font-medium border rounded-lg transition-all relative overflow-hidden ${
        isSelected
          ? 'bg-zinc-900 text-white border-zinc-900 shadow-md z-10'
          : 'border-zinc-200 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 bg-white hover:bg-zinc-50'
      }`}
    >
      {isSelected && (
        <div className="absolute inset-0 bg-white/10 animate-pulse"></div>
      )}
      {time}
    </button>
  );
}
