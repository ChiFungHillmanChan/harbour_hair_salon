// Pure validation for the Admin → Opening Hours editor. Dependency-free so it
// can be unit-tested directly, and so the server action and the form can share
// exactly one definition of "these hours are usable".

export type DayInput = {
  /** 0-6, Sunday-Saturday — matches Availability.dayOfWeek. */
  dayOfWeek: number;
  isOff: boolean;
  /** HH:mm. Ignored when isOff. */
  startTime: string;
  endTime: string;
};

export type WeekValidation =
  | { ok: true; days: DayInput[] }
  | { ok: false; error: string };

/** Index is dayOfWeek, so DAY_NAMES[0] is Sunday — matches the column. */
export const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_OPEN = '10:00';
const DEFAULT_CLOSE = '19:00';

function toMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

export function validateWeek(days: DayInput[]): WeekValidation {
  // Structure first: the caller upserts on (stylistId, dayOfWeek), so a
  // duplicated or out-of-range day would either write ambiguously or create a
  // row `getAvailableSlots` never reads — dead data with no visible symptom.
  const seen = new Set<number>();
  for (const day of days) {
    if (!Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      return { ok: false, error: `${day.dayOfWeek} is not a day of the week.` };
    }
    if (seen.has(day.dayOfWeek)) {
      return { ok: false, error: `${DAY_NAMES[day.dayOfWeek]} was submitted twice.` };
    }
    seen.add(day.dayOfWeek);
  }
  if (seen.size !== 7) {
    const missing = DAY_NAMES.filter((_, i) => !seen.has(i));
    return { ok: false, error: `The week is incomplete — ${missing.join(', ')} missing.` };
  }

  const normalised: DayInput[] = [];
  for (const day of days) {
    // A closed day is never sold, so its times are irrelevant — the form keeps
    // the inputs mounted and can submit stale or empty values for one. Store a
    // usable window anyway, so reopening the day later cannot hand
    // getAvailableSlots an unparseable one.
    if (day.isOff) {
      normalised.push({
        ...day,
        startTime: HH_MM.test(day.startTime) ? day.startTime : DEFAULT_OPEN,
        endTime: HH_MM.test(day.endTime) ? day.endTime : DEFAULT_CLOSE,
      });
      continue;
    }

    const name = DAY_NAMES[day.dayOfWeek] ?? `Day ${day.dayOfWeek}`;

    if (!HH_MM.test(day.startTime) || !HH_MM.test(day.endTime)) {
      return { ok: false, error: `${name}: opening hours must be times like 09:30.` };
    }
    if (toMinutes(day.startTime) >= toMinutes(day.endTime)) {
      return { ok: false, error: `${name}: the closing time must be after the opening time.` };
    }
    normalised.push(day);
  }

  return { ok: true, days: normalised };
}

/**
 * How many slots a window yields for a given service length — the number the
 * Opening Hours screen shows beside each day.
 *
 * Mirrors `buildSlotsForWindow`'s loop (30-minute steps; a slot must finish by
 * closing time) without needing a date, a clock or the booked list. A test
 * pins the two together, because a count that disagrees with what customers
 * are offered is worse than showing no count at all.
 */
export function countSlots(startTime: string, endTime: string, serviceDuration: number): number {
  if (!HH_MM.test(startTime) || !HH_MM.test(endTime)) return 0;
  const span = toMinutes(endTime) - toMinutes(startTime);
  if (span < serviceDuration) return 0;
  return Math.floor((span - serviceDuration) / 30) + 1;
}
