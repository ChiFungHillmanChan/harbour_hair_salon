import { fromZonedTime } from 'date-fns-tz';

export const SALON_TIMEZONE = 'Europe/London';

/** Strict "HH:mm" (00:00–23:59). */
export const SALON_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Strict "YYYY-MM-DD". */
export const SALON_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidSalonTime(time: string): boolean {
  return SALON_TIME_RE.test(time);
}

export function isValidSalonDate(date: string): boolean {
  return SALON_DATE_RE.test(date);
}

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
export function toSalonDateStr(date: string | Date): string {
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
  const dateStr = toSalonDateStr(date);
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

/** The salon-local calendar date (YYYY-MM-DD, Europe/London) of an absolute instant. */
export function salonDateKey(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SALON_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * The UTC instants bounding the salon-local calendar day that `instant` falls
 * on. Used to scan a day's appointments correctly regardless of the server's
 * timezone or how the salon day maps onto UTC (DST included). Replaces the
 * fragile `startOfDay(instant)` + `setHours(23,59,59,999)` (server-local) pattern.
 */
export function salonDayWindow(instant: Date): { start: Date; end: Date } {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: SALON_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return {
    start: fromZonedTime(`${dateStr}T00:00:00.000`, SALON_TIMEZONE),
    end: fromZonedTime(`${dateStr}T23:59:59.999`, SALON_TIMEZONE),
  };
}

/** Minutes since salon-local midnight (Europe/London) for an absolute instant. */
export function salonMinutesOfDay(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SALON_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
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
