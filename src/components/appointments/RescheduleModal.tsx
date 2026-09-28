'use client';

import { useEffect, useState } from 'react';
import { fetchSlots, rescheduleAppointment } from '@/app/actions/booking';
import type { TimeSlot } from '@/app/services/booking-service';
import { resolveSalonDateTime } from '@/app/services/salon-time';
import { useLocale, useT } from '@/i18n/client';
import { formatSalonClock, formatSalonLongDate } from '@/i18n/dates';
import { clearDraft, useDraftState } from '@/i18n/draft-store';

interface RescheduleModalProps {
  appointmentId: string;
  stylistId: string;
  serviceDuration: number;
  currentDate: string; // ISO string
  onClose: () => void;
}

export function RescheduleModal({
  appointmentId,
  stylistId,
  serviceDuration,
  currentDate,
  onClose,
}: RescheduleModalProps) {
  const t = useT('appointments');
  const locale = useLocale();
  // The picked day and time survive a language switch (memory only).
  const draft = `appointments:reschedule:${appointmentId}`;
  const [selectedDate, setSelectedDate] = useDraftState(`${draft}:date`, '');
  const [selectedSlot, setSelectedSlot] = useDraftState<string | null>(`${draft}:slot`, null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  // A day restored after a language switch is fetched again on mount (below).
  const [loadingSlots, setLoadingSlots] = useState(() => selectedDate !== '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];

  function close() {
    clearDraft(`${draft}:date`);
    clearDraft(`${draft}:slot`);
    onClose();
  }

  // Times for one salon-local day; null when they could not be loaded.
  async function fetchDay(dateStr: string): Promise<TimeSlot[] | null> {
    try {
      // dateStr is the salon-local calendar day (YYYY-MM-DD) from the date input;
      // pass it straight through so slots share the server's salon day frame.
      const result = await fetchSlots(stylistId, dateStr, serviceDuration);
      return result.ok ? result.slots : null;
    } catch {
      return null;
    }
  }

  function showDay(daySlots: TimeSlot[] | null) {
    setSlots(daySlots ?? []);
    if (!daySlots) setError(t('reschedule.slotsFailed'));
    // A time kept across a language switch may have been taken since.
    setSelectedSlot((slot) => (slot && daySlots?.some((s) => s.available && s.time === slot) ? slot : null));
    setLoadingSlots(false);
  }

  async function handleDateChange(dateStr: string) {
    setSelectedDate(dateStr);
    setSelectedSlot(null);
    setError(null);

    if (!dateStr) {
      setSlots([]);
      return;
    }

    setLoadingSlots(true);
    showDay(await fetchDay(dateStr));
  }

  // After a language switch the dialog remounts with the day already picked:
  // fetch its times again rather than showing an empty list.
  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    fetchDay(selectedDate).then((daySlots) => {
      if (!cancelled) showDay(daySlots);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the restored day
  }, []);

  async function handleConfirm() {
    if (!selectedSlot || !selectedDate) return;

    setSubmitting(true);
    setError(null);

    try {
      // Pass the salon-local date + time as plain strings; the server resolves them
      // to the correct UTC instant in the salon timezone (Europe/London).
      const result = await rescheduleAppointment(appointmentId, selectedDate, selectedSlot);
      if (result.success) {
        close();
      } else {
        setError(result.error || t('reschedule.failed'));
      }
    } catch {
      setError(t('reschedule.unexpectedError'));
    } finally {
      setSubmitting(false);
    }
  }

  const availableSlots = slots.filter(s => s.available);

  // Pin to salon time so "Old" reads the salon-local time regardless of viewer TZ.
  const formatDateTime = (instant: Date) =>
    t('reschedule.dateTime', { date: formatSalonLongDate(locale, instant), time: formatSalonClock(locale, instant) });

  // Build the "New" preview from the SAME strings the server receives, resolved
  // in the salon timezone — a host-local `new Date(dateStr)` + setHours drifted a
  // day for viewers west of UTC.
  const formatNewDateTime = () => {
    if (!selectedDate || !selectedSlot) return '';
    return formatDateTime(resolveSalonDateTime(selectedDate, selectedSlot).utc);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`reschedule-title-${appointmentId}`}
        className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6 relative max-h-[90vh] overflow-y-auto"
      >
        <button
          onClick={close}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600 transition-colors"
          aria-label={t('reschedule.close')}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h3 id={`reschedule-title-${appointmentId}`} className="text-xl font-semibold text-zinc-900 mb-4">{t('reschedule.title')}</h3>

        <div className="mb-4">
          <label htmlFor={`reschedule-date-${appointmentId}`} className="block text-sm font-medium text-zinc-700 mb-1">{t('reschedule.date')}</label>
          <input
            id={`reschedule-date-${appointmentId}`}
            type="date"
            min={minDate}
            value={selectedDate}
            onChange={(e) => handleDateChange(e.target.value)}
            className="w-full border border-zinc-300 rounded-md px-3 py-2 text-zinc-900 focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        {loadingSlots && <p className="text-sm text-zinc-500 mb-4">{t('reschedule.loadingSlots')}</p>}

        {!loadingSlots && selectedDate && availableSlots.length === 0 && (
          <p className="text-sm text-zinc-500 mb-4">{t('reschedule.noSlots')}</p>
        )}

        {availableSlots.length > 0 && (
          <div className="mb-4">
            <p className="block text-sm font-medium text-zinc-700 mb-2">{t('reschedule.times')}</p>
            <div className="grid grid-cols-3 gap-2">
              {availableSlots.map((slot) => (
                <button
                  key={slot.time}
                  onClick={() => setSelectedSlot(slot.time)}
                  aria-pressed={selectedSlot === slot.time}
                  className={`py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                    selectedSlot === slot.time
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                  }`}
                >
                  {slot.time}
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedSlot && (
          <div className="mb-4 p-3 bg-zinc-50 rounded-md text-sm">
            <p className="text-zinc-600">
              <span className="font-medium">{t('reschedule.old')}</span> {formatDateTime(new Date(currentDate))}
            </p>
            <p className="text-zinc-900 mt-1">
              <span className="font-medium">{t('reschedule.new')}</span> {formatNewDateTime()}
            </p>
          </div>
        )}

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={close}
            className="flex-1 py-2 border border-zinc-300 rounded-md text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            {t('reschedule.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedSlot || submitting}
            className="flex-1 py-2 bg-zinc-900 text-white rounded-md hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? t('reschedule.submitting') : t('reschedule.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
