import { resolveSalonDateTime, SALON_DATE_RE, salonDateKey } from './salon-time';

export type CalendarView = 'day' | 'month' | 'year';
export type CalendarQuery = { date?: string | string[]; view?: string | string[] };

/** Validate date-only navigation and bound each query to the visible London period. */
export function resolveAdminCalendarRange(query: CalendarQuery, now = new Date()) {
  const requested = typeof query.date === 'string' ? query.date : '';
  const parsed = SALON_DATE_RE.test(requested) ? new Date(`${requested}T12:00:00Z`) : new Date(NaN);
  const valid = Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() >= 1000 && parsed.getUTCFullYear() < 9999 && parsed.toISOString().slice(0, 10) === requested;
  const dateStr = valid ? requested : salonDateKey(now);
  const view: CalendarView = query.view === 'day' || query.view === 'year' ? query.view : 'month';
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
