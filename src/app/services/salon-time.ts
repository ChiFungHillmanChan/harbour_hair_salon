import { fromZonedTime } from 'date-fns-tz';

export const SALON_TIMEZONE = 'Europe/London';

export type SalonDateTime = {
  /** Absolute instant (UTC) for the requested salon wall-clock time. */
  utc: Date;
  /** Salon-local calendar date, YYYY-MM-DD. */
  dateStr: string;
  /** Minutes since midnight of the requested wall-clock time. */
  timeMinutes: number;
  /** Day of week for the salon-local date (0 = Sunday … 6 = Saturday). */
  dayOfWeek: number;
};

/** Reduce a date input to its salon-local calendar date (YYYY-MM-DD). */
function toDateStr(date: string | Date): string {
  if (typeof date === 'string') {
    // Accept "YYYY-MM-DD" or a full ISO string — keep the date portion.
    return date.slice(0, 10);
  }
  // `<input type="date">` / Zod `coerce.date()` produce a UTC-midnight Date,
  // so read the calendar date from its UTC fields (host-timezone independent).
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Convert a salon-local calendar date + "HH:mm" wall-clock time into the correct
 * absolute UTC instant, interpreting the time in the salon's timezone
 * (Europe/London) so DST is handled correctly. Host-timezone independent.
 */
export function resolveSalonDateTime(date: string | Date, time: string): SalonDateTime {
  const dateStr = toDateStr(date);
  const [rawH, rawM] = time.split(':');
  const hours = Number(rawH);
  const minutes = Number(rawM ?? 0);
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');

  // Parse the wall-clock string as a time in the salon timezone.
  const utc = fromZonedTime(`${dateStr}T${hh}:${mm}:00`, SALON_TIMEZONE);
  // Weekday of the calendar date (noon avoids any DST/offset edge effects).
  const dayOfWeek = new Date(`${dateStr}T12:00:00.000Z`).getUTCDay();

  return { utc, dateStr, timeMinutes: hours * 60 + minutes, dayOfWeek };
}

/**
 * True when `timeMinutes` (minutes since midnight) falls within the availability
 * window [startTime, endTime). Start is inclusive, end is exclusive — matching
 * the existing create-path business-hours check.
 */
export function isWithinAvailability(
  timeMinutes: number,
  startTime: string,
  endTime: string,
): boolean {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return timeMinutes >= start && timeMinutes < end;
}
