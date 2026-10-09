'use client';

import Link from '@/i18n/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cancelAppointment, withdrawRescheduleRequest } from '@/app/actions/booking';
import type { RescheduleRequestView } from '@/app/lib/reschedule-request';
import type { PriceNature, PriceType, VatDisplay } from '@/app/services/pricing/policy';
import { useFormatPrice } from '@/components/pricing/PriceParts';
import { useLocale, useT } from '@/i18n/client';
import { formatSalonClock, formatSalonLongDate } from '@/i18n/dates';
import { useDraftState } from '@/i18n/draft-store';
import { RescheduleModal } from './RescheduleModal';

/**
 * The price as it was RECORDED on the booking (recorded-price.ts) — never
 * today's price list. Unknown for bookings made before prices were stored
 * per appointment; the type/VAT/consultation facts are null when the booking
 * has no stored quote.
 */
export type BookedPrice =
  | { known: true; amountPence: number; priceType: PriceType | null; vatDisplay: VatDisplay | null; priceNature: PriceNature | null }
  | { known: false };

type SerializedAppointment = {
  id: string;
  date: string; // ISO string
  status: string;
  stylist: { name: string };
  stylistId: string;
  /** nameIsEnglish: no published translation, so the English name is shown (marked lang="en"). */
  service: { name: string; nameIsEnglish?: boolean; duration: number };
  serviceId: string;
  price: BookedPrice;
  hasReview?: boolean;
  request: RescheduleRequestView;
};

interface AppointmentCardProps {
  appointment: SerializedAppointment;
  isUpcoming: boolean;
  /**
   * Passed down from the server page rather than imported: whether booking is
   * open is a database setting now, and a client component cannot read it.
   */
  bookingEnabled: boolean;
}

export function AppointmentCard({ appointment, isUpcoming, bookingEnabled }: AppointmentCardProps) {
  const t = useT('appointments');
  const tp = useT('pricing');
  const locale = useLocale();
  const formatPrice = useFormatPrice();
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  // An open reschedule dialog stays open across a language switch.
  const [showReschedule, setShowReschedule] = useDraftState(`appointments:reschedule:${appointment.id}`, false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [sent, setSent] = useState(false);

  const appointmentDate = new Date(appointment.date);
  const [isWithin24Hours] = useState(() => {
    const hoursUntil = (appointmentDate.getTime() - Date.now()) / (1000 * 60 * 60);
    return hoursUntil < 24;
  });

  // Pin to salon time so the server render (UTC on Vercel) and the browser render
  // agree — otherwise BST produces a hydration mismatch and non-UK viewers see
  // their own timezone. Always shows the salon-local time, in the page's language.
  const formattedDate = formatSalonLongDate(locale, appointmentDate);
  const formattedTime = formatSalonClock(locale, appointmentDate);

  const statusColors: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800',
    CONFIRMED: 'bg-green-100 text-green-800',
    CANCELLED: 'bg-red-100 text-red-800',
    COMPLETED: 'bg-zinc-100 text-zinc-600',
  };

  // The recorded amount and the notes that were true when it was booked.
  const { price } = appointment;
  const priceNotes: string[] = [];
  if (price.known) {
    if (price.priceType === 'NHS') priceNotes.push(tp('nhsApplied'));
    if (price.vatDisplay === 'EXCLUDED') priceNotes.push(tp('vatExcluded'));
    if (price.priceNature === 'SUBJECT_TO_CONSULTATION') priceNotes.push(tp('subjectToConsultation'));
  }

  // A PENDING request may be withdrawn at any time; the 24-hour lock only
  // applies once the salon has confirmed. Rescheduling requires a confirmed
  // appointment (the server enforces both — this just mirrors it in the UI).
  const isPending = appointment.status === 'PENDING';
  const cancelLocked = !isPending && isWithin24Hours;
  // Rescheduling books a new slot, so it is blocked server-side during
  // maintenance. Mirror that here: without this the button stayed live, the
  // slot fetch returned an empty list for every date, and the customer just saw
  // "No available slots" — reading as though the salon were fully booked.
  // Cancelling stays available.
  const rescheduleLocked = !bookingEnabled || isWithin24Hours;
  const rescheduleTitle = !bookingEnabled
    ? t('card.rescheduleUnavailable')
    : isWithin24Hours
      ? t('card.rescheduleTooLate')
      : undefined;

  async function handleCancel() {
    if (!window.confirm(t('card.confirmCancel'))) return;

    setCancelling(true);
    setError(null);

    try {
      // Errors come back in the page's language from the action.
      const result = await cancelAppointment(appointment.id);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error || t('card.cancelFailed'));
      }
    } catch {
      setError(t('card.unexpectedError'));
    } finally {
      setCancelling(false);
    }
  }

  async function handleWithdraw() {
    if (!window.confirm(t('card.confirmWithdrawRequest'))) return;
    setSent(false);
    setWithdrawing(true);
    setError(null);
    try {
      const result = await withdrawRescheduleRequest(appointment.id);
      if (result.success) router.refresh(); else setError(result.error || t('card.unexpectedError'));
    } catch {
      setError(t('card.unexpectedError'));
    } finally {
      setWithdrawing(false);
    }
  }
  const request = appointment.request;
  const requestWhen = request.state === 'none' ? null : {
    date: formatSalonLongDate(locale, new Date(request.requestedDate)),
    time: formatSalonClock(locale, new Date(request.requestedDate)),
  };

  return (
    <>
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-zinc-900" lang={appointment.service.nameIsEnglish ? 'en' : undefined}>{appointment.service.name}</h3>
            <p className="text-zinc-600">{t('card.withStylist', { name: appointment.stylist.name })}</p>
            <p className="text-zinc-700">
              {t('card.when', { date: formattedDate, time: formattedTime })}
            </p>
            <p className="text-zinc-600">
              {tp('minutes', { count: appointment.service.duration })} &middot; {price.known ? formatPrice(price.amountPence) : tp('unknownPrice')}
            </p>
            {priceNotes.length > 0 && <p className="text-xs text-zinc-500">{priceNotes.join(' · ')}</p>}
            {!price.known && <p className="text-xs text-zinc-500">{tp('unknownPriceHelp')}</p>}
          </div>

          <div className="flex flex-col items-start sm:items-end gap-3">
            <span
              className={`inline-block px-3 py-1 rounded-full text-xs font-medium uppercase tracking-wide ${
                statusColors[appointment.status] || 'bg-zinc-100 text-zinc-600'
              }`}
            >
              {t.dynamic(`status.${appointment.status}`, undefined, appointment.status)}
            </span>

            {isUpcoming && (
              <div className="flex gap-2">
                {!isPending && (
                  <button
                    onClick={() => setShowReschedule(true)}
                    disabled={rescheduleLocked}
                    className="px-4 py-2 text-sm border border-zinc-300 rounded-md text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={rescheduleTitle}
                  >
                    {request.state === 'open' ? t('card.changeRequest') : t('card.reschedule')}
                  </button>
                )}
                {request.state === 'open' && (
                  <button onClick={handleWithdraw} disabled={withdrawing}
                    className="px-4 py-2 text-sm border border-zinc-300 rounded-md text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {withdrawing ? t('card.withdrawingRequest') : t('card.withdrawRequest')}
                  </button>
                )}
                <button
                  onClick={handleCancel}
                  disabled={cancelLocked || cancelling}
                  className="px-4 py-2 text-sm border border-red-300 rounded-md text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={cancelLocked ? t('card.cancelTooLate') : undefined}
                >
                  {cancelling ? t('card.cancelling') : isPending ? t('card.withdraw') : t('card.cancel')}
                </button>
              </div>
            )}

            {!isUpcoming && appointment.status !== 'CANCELLED' && !appointment.hasReview && (
              <Link
                href={`/reviews/new?appointmentId=${appointment.id}`}
                className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-md font-medium hover:bg-black transition-colors"
              >
                {t('card.leaveReview')}
              </Link>
            )}
            {!isUpcoming && appointment.hasReview && (
              <span className="text-xs text-zinc-400 italic">{t('card.reviewSubmitted')}</span>
            )}
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {isUpcoming && isPending && (
          <p className="mt-3 text-xs text-amber-700">
            {t('card.awaitingConfirmation')}
          </p>
        )}
        {isUpcoming && cancelLocked && (
          <p className="mt-3 text-xs text-zinc-400">
            {t('card.changesLocked')}
          </p>
        )}
        {isUpcoming && !isPending && !bookingEnabled && !isWithin24Hours && (
          <p className="mt-3 text-xs text-amber-700">
            {t('card.maintenance')}
          </p>
        )}
        {isUpcoming && requestWhen && (
          <p className={`mt-3 text-xs ${request.state === 'open' ? 'text-amber-700' : 'text-zinc-500'}`}>
            {t(request.state === 'open' ? 'card.requestOpen' : 'card.requestExpired', requestWhen)}
          </p>
        )}
        {sent && request.state === 'open' && <p className="mt-3 text-xs text-zinc-700">{t('reschedule.sent')}</p>}
      </div>

      {showReschedule && (
        <RescheduleModal
          appointmentId={appointment.id}
          stylistId={appointment.stylistId}
          serviceDuration={appointment.service.duration}
          currentDate={appointment.date}
          onSent={() => setSent(true)}
          onClose={() => {
            setShowReschedule(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
