import { CALENDAR_WINDOW_DAYS } from './calendar-ical';
import { CALENDAR_FRESHNESS_MINUTES } from './treatwell-sync-coverage';

/** Leave room for the oldest feed still accepted by the readiness check. */
export function bookingCoverageEndsAt(now = new Date()): Date {
  return new Date(now.getTime() + CALENDAR_WINDOW_DAYS * 86_400_000 - CALENDAR_FRESHNESS_MINUTES * 60_000);
}

export function isWithinBookingHorizon(start: Date, durationMinutes: number, now = new Date()): boolean {
  return Number.isFinite(start.getTime()) && Number.isFinite(durationMinutes) && durationMinutes > 0 &&
    start > now && start.getTime() + durationMinutes * 60_000 <= bookingCoverageEndsAt(now).getTime();
}
