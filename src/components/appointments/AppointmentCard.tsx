'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cancelAppointment } from '@/app/actions/booking';
import { BOOKING_MAINTENANCE } from '@/app/lib/booking-maintenance';
import { RescheduleModal } from './RescheduleModal';

type SerializedAppointment = {
  id: string;
  date: string; // ISO string
  status: string;
  stylist: { name: string };
  stylistId: string;
  service: { name: string; price: number; duration: number };
  serviceId: string;
  hasReview?: boolean;
};

interface AppointmentCardProps {
  appointment: SerializedAppointment;
  isUpcoming: boolean;
}

export function AppointmentCard({ appointment, isUpcoming }: AppointmentCardProps) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appointmentDate = new Date(appointment.date);
  const [isWithin24Hours] = useState(() => {
    const hoursUntil = (appointmentDate.getTime() - Date.now()) / (1000 * 60 * 60);
    return hoursUntil < 24;
  });

  const formattedDate = appointmentDate.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const formattedTime = appointmentDate.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const statusColors: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800',
    CONFIRMED: 'bg-green-100 text-green-800',
    CANCELLED: 'bg-red-100 text-red-800',
    COMPLETED: 'bg-zinc-100 text-zinc-600',
  };

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
  const rescheduleLocked = BOOKING_MAINTENANCE || isWithin24Hours;
  const rescheduleTitle = BOOKING_MAINTENANCE
    ? 'Online rescheduling is temporarily unavailable — please call the salon'
    : isWithin24Hours
      ? 'Cannot reschedule within 24 hours'
      : undefined;

  async function handleCancel() {
    if (!window.confirm('Are you sure you want to cancel this appointment?')) return;

    setCancelling(true);
    setError(null);

    const result = await cancelAppointment(appointment.id);

    if (result.success) {
      router.refresh();
    } else {
      setError(result.error || 'Failed to cancel');
    }
    setCancelling(false);
  }

  return (
    <>
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-zinc-900">{appointment.service.name}</h3>
            <p className="text-zinc-600">with {appointment.stylist.name}</p>
            <p className="text-zinc-700">
              {formattedDate} at {formattedTime}
            </p>
            <p className="text-zinc-600">
              {appointment.service.duration} mins &middot; &pound;{appointment.service.price.toFixed(2)}
            </p>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-3">
            <span
              className={`inline-block px-3 py-1 rounded-full text-xs font-medium uppercase tracking-wide ${
                statusColors[appointment.status] || 'bg-zinc-100 text-zinc-600'
              }`}
            >
              {appointment.status}
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
                    Reschedule
                  </button>
                )}
                <button
                  onClick={handleCancel}
                  disabled={cancelLocked || cancelling}
                  className="px-4 py-2 text-sm border border-red-300 rounded-md text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={cancelLocked ? 'Cannot cancel within 24 hours' : undefined}
                >
                  {cancelling ? 'Cancelling...' : isPending ? 'Withdraw request' : 'Cancel'}
                </button>
              </div>
            )}

            {!isUpcoming && appointment.status !== 'CANCELLED' && !appointment.hasReview && (
              <Link
                href={`/reviews/new?appointmentId=${appointment.id}`}
                className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-md font-medium hover:bg-black transition-colors"
              >
                Leave a review
              </Link>
            )}
            {!isUpcoming && appointment.hasReview && (
              <span className="text-xs text-zinc-400 italic">Review submitted</span>
            )}
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {isUpcoming && isPending && (
          <p className="mt-3 text-xs text-amber-700">
            Awaiting confirmation from the salon — we&apos;ll email you once it&apos;s confirmed.
          </p>
        )}
        {isUpcoming && cancelLocked && (
          <p className="mt-3 text-xs text-zinc-400">
            Changes cannot be made within 24 hours of your appointment.
          </p>
        )}
        {isUpcoming && !isPending && BOOKING_MAINTENANCE && !isWithin24Hours && (
          <p className="mt-3 text-xs text-amber-700">
            Online rescheduling is temporarily unavailable while our booking system is
            under maintenance. Please call the salon to move this appointment.
          </p>
        )}
      </div>

      {showReschedule && (
        <RescheduleModal
          appointmentId={appointment.id}
          stylistId={appointment.stylistId}
          serviceDuration={appointment.service.duration}
          currentDate={appointment.date}
          onClose={() => {
            setShowReschedule(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
