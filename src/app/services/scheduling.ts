import { addMinutes } from 'date-fns';
import { resolveSalonDateTime } from './salon-time';

export type BookedInterval = { start: Date; durationMin: number };

/**
 * True when two appointments [start, start+duration) overlap. Intervals are
 * half-open, so back-to-back appointments (one ends exactly when the next
 * starts) do NOT overlap.
 */
export function overlaps(
  startA: Date,
  durationA: number,
  startB: Date,
  durationB: number,
): boolean {
  const endA = addMinutes(startA, durationA);
  const endB = addMinutes(startB, durationB);
  return startA < endB && startB < endA;
}

/** True when [start, start+duration) collides with any existing interval. */
export function hasConflict(
  start: Date,
  durationMin: number,
  existing: BookedInterval[],
): boolean {
  return existing.some((e) => overlaps(start, durationMin, e.start, e.durationMin));
}

/**
 * Given candidate stylist IDs in priority order and their booked intervals,
 * return the first stylist with no conflict for [start, start+duration), or
 * null if every candidate is busy.
 */
export function firstFreeStylist(
  candidateIds: string[],
  start: Date,
  durationMin: number,
  bookedByStylist: Map<string, BookedInterval[]>,
): string | null {
  for (const id of candidateIds) {
    const booked = bookedByStylist.get(id) ?? [];
    if (!hasConflict(start, durationMin, booked)) return id;
  }
  return null;
}

export type TimeSlot = { time: string; available: boolean };

/**
 * Build bookable slot start-times for one availability window on a salon-local
 * calendar date (YYYY-MM-DD). Each slot's absolute instant is derived with
 * resolveSalonDateTime so it matches how appointments are STORED (BST/GMT correct
 * and host-timezone independent — never construct slot instants with host-local
 * date-fns startOfDay/setHours). `now` is injected: slots at or before it are hidden.
 */
export function buildSlotsForWindow(
  dateStr: string,
  availability: { startTime: string; endTime: string },
  booked: BookedInterval[],
  serviceDuration: number,
  now: Date,
): TimeSlot[] {
  const [sh, sm] = availability.startTime.split(':').map(Number);
  const [eh, em] = availability.endTime.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;

  const slots: TimeSlot[] = [];
  for (let mins = startMins; mins + serviceDuration <= endMins; mins += 30) {
    const label = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const slotStart = resolveSalonDateTime(dateStr, label).utc;
    if (slotStart <= now) continue; // hide past slots (same-day)
    if (!hasConflict(slotStart, serviceDuration, booked)) {
      slots.push({ time: label, available: true });
    }
  }
  return slots;
}
