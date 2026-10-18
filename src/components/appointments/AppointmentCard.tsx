'use client';

import Link from '@/i18n/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cancelAppointment, withdrawRescheduleRequest } from '@/app/actions/booking';
import type { RescheduleRequestView } from '@/app/lib/reschedule-request';
import type { DepositView } from '@/app/lib/deposit-display';
import type { PriceNature, PriceType, VatDisplay } from '@/app/services/pricing/policy';
import { requiresEligibilityProof } from '@/app/services/pricing/eligibility';
import { useFormatPrice } from '@/components/pricing/PriceParts';
import { useLocale, useT } from '@/i18n/client';
import { formatSalonClock, formatSalonLongDate } from '@/i18n/dates';
import { useDraftState } from '@/i18n/draft-store';
import { appointmentGoogleCalendarUrl, appointmentIcsBlob, type AppointmentCalendarEvent } from '@/app/lib/calendar-links';
import { DEPOSIT_REFUND_NOTICE_HOURS, LATE_ARRIVAL_CANCEL_MINUTES, isDepositRefundableOnCancel } from '@/app/lib/booking-constants';
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
  /** The salon cancelled it because the customer was late (never set on a restored booking's status). */
  lateCancelled?: boolean;
  stylist: { name: string };
  stylistId: string;
  /** nameIsEnglish: no published translation, so the English name is shown (marked lang="en"). */
  service: { name: string; nameIsEnglish?: boolean; duration: number };
  serviceId: string;
  price: BookedPrice;
  /** The consultation credit recorded on the booking (pence), taken off what is paid in the salon; null: none. */
  consultationCreditPence?: number | null;
  /** The card deposit's state (lib/deposit-display.ts); absent or null: none. */
  deposit?: DepositView | null;
  /** Moved at the customer's request made inside DEPOSIT_REFUND_NOTICE_HOURS: cancelling keeps the deposit (Appointment.depositLockedAt). */
  depositLocked?: boolean;
  hasReview?: boolean;
  request: RescheduleRequestView;
  /** The entry for the customer's own calendar: confirmed, upcoming bookings only. */
  calendar?: AppointmentCalendarEvent | null;
};

/**
 * Save the appointment as an .ics file. Made here on the device from what the
 * page already holds — no request, so no database work.
 */
function downloadCalendarFile(event: AppointmentCalendarEvent) {
  const href = URL.createObjectURL(appointmentIcsBlob(event));
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = event.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Let the browser start the download before the file is released.
  setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

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
  // The server refused a cancellation because the refund deadline passed
  // while the confirm step was open (DEPOSIT_NOW_KEPT): say "kept" from now on.
  const [refundDeadlinePassed, setRefundDeadlinePassed] = useState(false);

  const appointmentDate = new Date(appointment.date);
  const [isWithin24Hours] = useState(() => {
    const hoursUntil = (appointmentDate.getTime() - Date.now()) / (1000 * 60 * 60);
    return hoursUntil < 24;
  });
  // Cancelling from now on keeps a taken deposit (DEPOSIT_REFUND_NOTICE_HOURS,
  // or for good once moved at a request made inside that window).
  const depositLocked = appointment.depositLocked === true;
  const [pastRefundDeadline] = useState(() => depositLocked || !isDepositRefundableOnCancel(appointmentDate, new Date()));
  const refundDeadline = new Date(appointmentDate.getTime() - DEPOSIT_REFUND_NOTICE_HOURS * 3_600_000);

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
  const deposit = appointment.deposit ?? null;
  // A cancelled booking deducts nothing: its credit is free again for another booking.
  const credit = appointment.status !== 'CANCELLED' && appointment.consultationCreditPence && appointment.consultationCreditPence > 0
    ? appointment.consultationCreditPence : null;
  // What is left to pay in the salon once a taken deposit and the credit are off — never below £0.
  const toPayInSalon = credit !== null && price.known && isUpcoming && ['CONFIRMED', 'PENDING'].includes(appointment.status)
    ? Math.max(0, price.amountPence - (deposit?.state === 'PAID' ? deposit.amountPence : 0) - credit)
    : null;
  // …with the price's own fine print when that amount is not exact, as the emails say it.
  const toPayNotes = price.known
    ? [
        ...(price.vatDisplay === 'EXCLUDED' ? [tp('vatExcluded')] : []),
        ...(price.priceNature === 'SUBJECT_TO_CONSULTATION' ? [tp('subjectToConsultation')] : []),
      ]
    : [];
  const priceNotes: string[] = [];
  if (price.known) {
    if (price.priceType === 'NHS') priceNotes.push(tp('nhsApplied'));
    if (price.vatDisplay === 'EXCLUDED') priceNotes.push(tp('vatExcluded'));
    if (price.priceNature === 'SUBJECT_TO_CONSULTATION') priceNotes.push(tp('subjectToConsultation'));
  }

  // An NHS or student price is honoured on proof at the appointment: say so
  // while the booking can still go ahead.
  const needsProof = isUpcoming && price.known && price.priceType !== null && requiresEligibilityProof({ priceType: price.priceType });

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
    // Say what happens to the deposit before the customer agrees: a taken one
    // is refunded in full DEPOSIT_REFUND_NOTICE_HOURS or more before the
    // appointment and kept after that; a hold is released. Worked out at the
    // click, and the server is told which was shown (cancelAppointment).
    const amount = deposit ? formatPrice(deposit.amountPence) : '';
    const depositKept = deposit?.state === 'PAID' && appointment.status === 'CONFIRMED'
      && (depositLocked || refundDeadlinePassed || !isDepositRefundableOnCancel(appointmentDate, new Date()));
    const confirmText = depositKept
      ? t(depositLocked ? 'card.confirmCancelKeptMoved' : 'card.confirmCancelKept', { amount, hours: DEPOSIT_REFUND_NOTICE_HOURS })
      : deposit?.state === 'PAID'
        ? t('card.confirmCancelRefund', { amount })
        : deposit?.state === 'HELD'
          ? t('card.confirmWithdrawRelease', { amount })
          : t('card.confirmCancel');
    if (!window.confirm(confirmText)) return;

    setCancelling(true);
    setError(null);

    try {
      // Errors come back in the page's language from the action.
      const result = await cancelAppointment(appointment.id, { depositKept });
      if (result.success) {
        router.refresh();
      } else {
        if (result.code === 'DEPOSIT_NOW_KEPT') setRefundDeadlinePassed(true);
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
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0 space-y-1 text-sm sm:text-base">
            <h3 className="text-base sm:text-lg font-semibold text-zinc-900" lang={appointment.service.nameIsEnglish ? 'en' : undefined}>{appointment.service.name}</h3>
            <p className="text-zinc-600">{t('card.withStylist', { name: appointment.stylist.name })}</p>
            <p className="text-zinc-700">
              {t('card.when', { date: formattedDate, time: formattedTime })}
            </p>
            <p className="text-zinc-600">
              {tp('minutes', { count: appointment.service.duration })} &middot; {price.known ? formatPrice(price.amountPence) : tp('unknownPrice')}
            </p>
            {priceNotes.length > 0 && <p className="text-xs text-zinc-500">{priceNotes.join(' · ')}</p>}
            {credit !== null && <p className="text-sm text-zinc-700">{t('card.consultationCredit', { amount: formatPrice(credit) })}</p>}
            {toPayInSalon !== null && (
              <p className="text-sm text-zinc-700">
                {toPayNotes.length > 0
                  ? t('card.toPayInSalonWithNotes', { amount: formatPrice(toPayInSalon), notes: toPayNotes.join(' · ') })
                  : t('card.toPayInSalon', { amount: formatPrice(toPayInSalon) })}
              </p>
            )}
            {needsProof && <p className="text-xs text-zinc-500">{tp('eligibilityProof')}</p>}
            {!price.known && <p className="text-xs text-zinc-500">{tp('unknownPriceHelp')}</p>}
            {deposit && (
              <p className="text-sm text-zinc-700">{t.dynamic(`deposit.${deposit.state}`, { amount: formatPrice(deposit.amountPence) })}</p>
            )}
            {/* A taken deposit on a confirmed booking: until when cancelling refunds it. */}
            {deposit?.state === 'PAID' && appointment.status === 'CONFIRMED' && isUpcoming && (
              <p className="text-xs text-zinc-500">
                {depositLocked
                  ? t('card.depositKeptAfterMove', { hours: DEPOSIT_REFUND_NOTICE_HOURS })
                  : pastRefundDeadline || refundDeadlinePassed
                  ? t('card.depositKeptIfCancelled', { hours: DEPOSIT_REFUND_NOTICE_HOURS })
                  : t('card.refundUntil', { date: formatSalonLongDate(locale, refundDeadline), time: formatSalonClock(locale, refundDeadline) })}
              </p>
            )}
          </div>

          <div className="flex min-w-0 flex-col items-start sm:items-end gap-3 sm:max-w-[48%]">
            <span
              className={`inline-block px-3 py-1 rounded-full text-xs font-medium uppercase tracking-wide ${
                statusColors[appointment.status] || 'bg-zinc-100 text-zinc-600'
              }`}
            >
              {appointment.status === 'CANCELLED' && appointment.lateCancelled
                ? t('status.LATE_CANCELLED', { minutes: LATE_ARRIVAL_CANCEL_MINUTES })
                : t.dynamic(`status.${appointment.status}`, undefined, appointment.status)}
            </span>

            {isUpcoming && (
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {!isPending && (
                  <button
                    onClick={() => setShowReschedule(true)}
                    disabled={rescheduleLocked}
                    className="min-h-11 px-3 py-2.5 text-sm border border-zinc-300 rounded-md text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={rescheduleTitle}
                  >
                    {request.state === 'open' ? t('card.changeRequest') : t('card.reschedule')}
                  </button>
                )}
                {request.state === 'open' && (
                  <button onClick={handleWithdraw} disabled={withdrawing}
                    className="min-h-11 px-3 py-2.5 text-sm border border-zinc-300 rounded-md text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {withdrawing ? t('card.withdrawingRequest') : t('card.withdrawRequest')}
                  </button>
                )}
                <button
                  onClick={handleCancel}
                  disabled={cancelLocked || cancelling}
                  className="min-h-11 px-3 py-2.5 text-sm border border-red-300 rounded-md text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={cancelLocked ? t('card.cancelTooLate') : undefined}
                >
                  {cancelling ? t('card.cancelling') : isPending ? t('card.withdraw') : t('card.cancel')}
                </button>
              </div>
            )}

            {!isUpcoming && appointment.status !== 'CANCELLED' && appointment.status !== 'PENDING' && !appointment.hasReview && (
              <Link
                href={`/reviews/new?appointmentId=${appointment.id}`}
                className="inline-flex items-center min-h-11 px-3 py-2.5 text-sm bg-zinc-900 text-white rounded-md font-medium hover:bg-black transition-colors"
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

        {isUpcoming && appointment.calendar && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
            <a
              href={appointmentGoogleCalendarUrl(appointment.calendar)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 min-h-11 px-3 py-2.5 text-sm border border-zinc-300 rounded-md text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              <CalendarIcon />
              {t('card.addToGoogleCalendar')}
              <span className="sr-only"> {t('card.opensInNewTab')}</span>
            </a>
            <button
              type="button"
              onClick={() => downloadCalendarFile(appointment.calendar!)}
              className="inline-flex items-center gap-2 min-h-11 px-3 py-2.5 text-sm border border-zinc-300 rounded-md text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              <DownloadIcon />
              {t('card.downloadCalendarFile')}
            </button>
          </div>
        )}

        {isUpcoming && isPending && (
          <p className="mt-3 text-xs text-amber-700">
            {t('card.awaitingConfirmation')}
          </p>
        )}
        {isUpcoming && isPending && (
          <p className="mt-1 text-xs text-zinc-500">
            {t('card.calendarAfterConfirmation')}
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
          keptDepositPence={deposit?.state === 'PAID' && (pastRefundDeadline || refundDeadlinePassed) ? deposit.amountPence : null}
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

function CalendarIcon() {
  return (
    <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}
