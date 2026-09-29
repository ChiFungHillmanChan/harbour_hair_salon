import { resolveSalonDateTime } from './salon-time';
import { buildSlotGridForWindow, type BookedInterval, type TimeSlot } from './scheduling';

export type WorkingHours = { dayOfWeek: number; startTime: string; endTime: string };

/**
 * One salon day as the booking page shows it. A day with no bookable time is
 * UNAVAILABLE whatever the reason — a Fresha "Pause", a weekly day off, or
 * every time taken — because the public page never says why.
 */
export type BookingDay = {
  /** Salon-local calendar date, YYYY-MM-DD. */
  date: string;
  status: 'OPEN' | 'UNAVAILABLE';
  /** Earliest start and latest finish of everyone rostered that day; null when nobody is. */
  hours: { start: string; end: string } | null;
  /** Every future start time, taken ones flagged unavailable. Empty when the day is UNAVAILABLE. */
  slots: TimeSlot[];
};

/**
 * Pure: turn working hours and busy intervals (appointments + synced blocks,
 * already loaded for the whole range) into per-day availability. With several
 * stylists ("Anyone") a time is free when at least one rostered stylist is.
 */
export function buildBookingDays(input: {
  dates: readonly string[];
  duration: number;
  now: Date;
  hoursByStylist: ReadonlyMap<string, readonly WorkingHours[]>;
  busyByStylist: ReadonlyMap<string, readonly BookedInterval[]>;
  bookable: (start: Date, duration: number) => boolean;
}): BookingDay[] {
  return input.dates.map((date) => {
    const { dayOfWeek } = resolveSalonDateTime(date, '12:00');
    const free = new Map<string, boolean>();
    let start: string | null = null;
    let end: string | null = null;
    for (const [stylistId, rows] of input.hoursByStylist) {
      const hours = rows.find((row) => row.dayOfWeek === dayOfWeek);
      if (!hours) continue;
      // HH:mm strings are zero-padded, so string order is time order.
      if (start === null || hours.startTime < start) start = hours.startTime;
      if (end === null || hours.endTime > end) end = hours.endTime;
      const busy = [...(input.busyByStylist.get(stylistId) ?? [])];
      for (const slot of buildSlotGridForWindow(date, hours, busy, input.duration, input.now)) {
        if (!input.bookable(resolveSalonDateTime(date, slot.time).utc, input.duration)) continue;
        free.set(slot.time, (free.get(slot.time) ?? false) || slot.available);
      }
    }
    const slots = [...free]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, available]) => ({ time, available }));
    const open = slots.some((slot) => slot.available);
    return {
      date,
      status: open ? 'OPEN' : 'UNAVAILABLE',
      hours: start !== null && end !== null ? { start, end } : null,
      slots: open ? slots : [],
    };
  });
}
