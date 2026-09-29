import { BOOKING_DAYS_MAX } from '@/app/lib/booking-constants';
import { CALENDAR_WINDOW_DAYS } from './calendar-ical';
import { salonDateKey, SALON_DATE_RE } from './salon-time';
import { CALENDAR_FRESHNESS_MINUTES } from './treatwell-sync-coverage';

const DAY_MS = 86_400_000;

/** Leave room for the oldest feed still accepted by the readiness check. */
export function bookingCoverageEndsAt(now = new Date()): Date {
  return new Date(now.getTime() + CALENDAR_WINDOW_DAYS * DAY_MS - CALENDAR_FRESHNESS_MINUTES * 60_000);
}

export function isWithinBookingHorizon(start: Date, durationMinutes: number, now = new Date()): boolean {
  return Number.isFinite(start.getTime()) && Number.isFinite(durationMinutes) && durationMinutes > 0 &&
    start > now && start.getTime() + durationMinutes * 60_000 <= bookingCoverageEndsAt(now).getTime();
}

/** Days since the epoch for a real YYYY-MM-DD calendar day; null for "2026-02-30" and other non-days. */
function calendarDayNumber(date: unknown): number | null {
  if (typeof date !== 'string' || !SALON_DATE_RE.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) return null;
  return ms / DAY_MS;
}

/**
 * Whether the anonymous availability actions may look these days up at all.
 *
 * The date strip is built from the browser's own "today", so one day of slack
 * either side of the salon's (Europe/London) today and last bookable day lets a
 * visitor a timezone away through. Everything else is refused before any query:
 * the service reads appointments and busy blocks across min..max of the dates,
 * so two dates like 1900-01-01 and 9999-12-31 would otherwise scan the whole
 * calendar on every anonymous call.
 */
export function isBookableDateWindow(dates: readonly unknown[], now = new Date()): boolean {
  if (dates.length === 0) return false;
  const first = calendarDayNumber(salonDateKey(now))! - 1;
  const last = calendarDayNumber(salonDateKey(bookingCoverageEndsAt(now)))! + 1;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const date of dates) {
    const day = calendarDayNumber(date);
    if (day === null || day < first || day > last) return false;
    min = Math.min(min, day);
    max = Math.max(max, day);
  }
  return max - min <= BOOKING_DAYS_MAX - 1;
}
