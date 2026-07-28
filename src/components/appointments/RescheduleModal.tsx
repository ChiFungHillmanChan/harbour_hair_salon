'use client';

import { useState } from 'react';
import { fetchSlots, rescheduleAppointment } from '@/app/actions/booking';
import type { TimeSlot } from '@/app/services/booking-service';
import { formatSalonDate, formatSalonTime, resolveSalonDateTime } from '@/app/services/salon-time';

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
  const [selectedDate, setSelectedDate] = useState('');
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];

  async function handleDateChange(dateStr: string) {
    setSelectedDate(dateStr);
    setSelectedSlot(null);
    setError(null);

    if (!dateStr) {
      setSlots([]);
      return;
    }

    setLoadingSlots(true);
    try {
      // dateStr is the salon-local calendar day (YYYY-MM-DD) from the date input;
      // pass it straight through so slots share the server's salon day frame.
      const result = await fetchSlots(stylistId, dateStr, serviceDuration);
      if (result.ok) {
        setSlots(result.slots);
      } else {
        setSlots([]);
        setError("We couldn't load available times. Please try again, or call the salon.");
      }
    } catch {
      setError("We couldn't load available times. Please try again, or call the salon.");
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }

  async function handleConfirm() {
    if (!selectedSlot || !selectedDate) return;

    setSubmitting(true);
    setError(null);

    try {
      // Pass the salon-local date + time as plain strings; the server resolves them
      // to the correct UTC instant in the salon timezone (Europe/London).
      const result = await rescheduleAppointment(appointmentId, selectedDate, selectedSlot);
      if (result.success) {
        onClose();
      } else {
        setError(result.error || 'Reschedule failed');
      }
    } catch {
      setError('Something went wrong. Please try again, or call the salon.');
    } finally {
      setSubmitting(false);
    }
  }

  const availableSlots = slots.filter(s => s.available);

  // Pin to salon time so "Old" reads the salon-local time regardless of viewer TZ.
  const formatDateTime = (isoString: string) => {
    const d = new Date(isoString);
    return `${formatSalonDate(d)}, ${formatSalonTime(d)}`;
  };

  // Build the "New" preview from the SAME strings the server receives, resolved
  // in the salon timezone — a host-local `new Date(dateStr)` + setHours drifted a
  // day for viewers west of UTC.
  const formatNewDateTime = () => {
    if (!selectedDate || !selectedSlot) return '';
    const { utc } = resolveSalonDateTime(selectedDate, selectedSlot);
    return `${formatSalonDate(utc)}, ${formatSalonTime(utc)}`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6 relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600 transition-colors"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h3 className="text-xl font-semibold text-zinc-900 mb-4">Reschedule Appointment</h3>

        <div className="mb-4">
          <label className="block text-sm font-medium text-zinc-700 mb-1">Select New Date</label>
          <input
            type="date"
            min={minDate}
            value={selectedDate}
            onChange={(e) => handleDateChange(e.target.value)}
            className="w-full border border-zinc-300 rounded-md px-3 py-2 text-zinc-900 focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        {loadingSlots && <p className="text-sm text-zinc-500 mb-4">Loading available slots...</p>}

        {!loadingSlots && selectedDate && availableSlots.length === 0 && (
          <p className="text-sm text-zinc-500 mb-4">No available slots for this date.</p>
        )}

        {availableSlots.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-zinc-700 mb-2">Available Times</label>
            <div className="grid grid-cols-3 gap-2">
              {availableSlots.map((slot) => (
                <button
                  key={slot.time}
                  onClick={() => setSelectedSlot(slot.time)}
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
              <span className="font-medium">Old:</span> {formatDateTime(currentDate)}
            </p>
            <p className="text-zinc-900 mt-1">
              <span className="font-medium">New:</span> {formatNewDateTime()}
            </p>
          </div>
        )}

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-zinc-300 rounded-md text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedSlot || submitting}
            className="flex-1 py-2 bg-zinc-900 text-white rounded-md hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Rescheduling...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
