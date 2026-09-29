import type { BookingDay } from '@/app/services/booking-days';

/**
 * After the booking page re-reads its fortnight (e.g. the server refused a
 * booking because the time had just gone): keep the chosen time only while it
 * is still free. If it went while the customer was on the confirm step, send
 * them back to the times — the greyed slot then explains itself — rather than
 * leave them on a summary with no time and a button that does nothing.
 */
export function reconcileSelection<S extends string>(
  days: readonly BookingDay[],
  day: string,
  time: string | null,
  step: S,
): { time: string | null; step: S | 'DATE' } {
  if (!time) return { time, step };
  const free = days.find((entry) => entry.date === day)?.slots.some((slot) => slot.available && slot.time === time);
  if (free) return { time, step };
  return { time: null, step: step === 'CONFIRM' ? 'DATE' : step };
}
