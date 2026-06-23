import { addMinutes } from 'date-fns';

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
