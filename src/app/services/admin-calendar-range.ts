import { resolveSalonDateTime, SALON_DATE_RE, salonDateKey } from './salon-time';

export type CalendarView = 'day' | 'week' | 'month' | 'year';
export type CalendarQuery = { date?: string | string[]; view?: string | string[] };

/**
 * The selectable periods, in the order the toolbar shows them.
 *
 * `day` is first AND the fallback: the salon opens this board on the shop floor
 * every morning to work today's diary, so landing on a month grid meant an extra
 * click before the screen was useful.
 */
export const CALENDAR_VIEWS = ['day', 'week', 'month', 'year'] as const;

export const DEFAULT_CALENDAR_VIEW: CalendarView = 'day';

export function isCalendarView(value: unknown): value is CalendarView {
  return typeof value === 'string' && (CALENDAR_VIEWS as readonly string[]).includes(value);
}

/** Validate date-only navigation and bound each query to the visible London period. */
export function resolveAdminCalendarRange(query: CalendarQuery, now = new Date()) {
  const requested = typeof query.date === 'string' ? query.date : '';
  const parsed = SALON_DATE_RE.test(requested) ? new Date(`${requested}T12:00:00Z`) : new Date(NaN);
  const valid = Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() >= 1000 && parsed.getUTCFullYear() < 9999 && parsed.toISOString().slice(0, 10) === requested;
  const dateStr = valid ? requested : salonDateKey(now);
  const view: CalendarView = isCalendarView(query.view) ? query.view : DEFAULT_CALENDAR_VIEW;
  // UTC dates here are calendar arithmetic only. Resolve the boundaries in London
  // afterwards, so DST days can correctly contain 23 or 25 hours.
  const start = new Date(`${dateStr}T12:00:00Z`);
  const end = new Date(start);
  if (view === 'year') {
    start.setUTCMonth(0, 1);
    end.setUTCFullYear(end.getUTCFullYear() + 1, 0, 1);
  } else if (view === 'month') {
    start.setUTCDate(1);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    end.setUTCMonth(end.getUTCMonth() + 1, 1);
    end.setUTCDate(end.getUTCDate() + (7 - end.getUTCDay()) % 7);
  } else if (view === 'week') {
    // Sunday-start, matching the month grid's column headings — the two views
    // sit on the same screen and must not disagree about where a week begins.
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    end.setUTCDate(end.getUTCDate() - end.getUTCDay() + 7);
  } else {
    end.setUTCDate(end.getUTCDate() + 1);
  }
  return {
    dateStr,
    view,
    range: {
      gte: resolveSalonDateTime(start.toISOString().slice(0, 10), '00:00').utc,
      lt: resolveSalonDateTime(end.toISOString().slice(0, 10), '00:00').utc,
    },
  };
}

/** The seven salon calendar days the week view draws, Sunday first. */
export function weekDayKeys(dateStr: string): string[] {
  const cursor = new Date(`${dateStr}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());
  return Array.from({ length: 7 }, () => {
    const key = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    return key;
  });
}
