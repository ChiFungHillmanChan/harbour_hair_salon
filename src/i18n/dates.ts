import { HTML_LANG, type Locale } from './config';

const SALON_TIMEZONE = 'Europe/London';
const cache = new Map<string, Intl.DateTimeFormat>();

/**
 * Format an instant for a human in the salon's timezone (Europe/London, so the
 * same on a UTC server and any browser) and the page's language. Only the
 * wording changes with the language — never the day, hour or DST handling.
 */
export function formatSalon(locale: Locale, instant: Date, options: Intl.DateTimeFormatOptions): string {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = cache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(HTML_LANG[locale], { timeZone: SALON_TIMEZONE, ...options });
    cache.set(key, formatter);
  }
  return formatter.format(instant);
}

/** "Saturday, 1 August 2026" / "2026年8月1日星期六" */
export const formatSalonLongDate = (locale: Locale, instant: Date) =>
  formatSalon(locale, instant, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

/** "1 Aug 2026" / "2026年8月1日" */
export const formatSalonMediumDate = (locale: Locale, instant: Date) =>
  formatSalon(locale, instant, { year: 'numeric', month: 'short', day: 'numeric' });

/** "14:00" in both languages (24-hour clock, as the salon publishes its hours). */
export const formatSalonClock = (locale: Locale, instant: Date) =>
  formatSalon(locale, instant, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "1 Aug 2026, 14:00" */
export const formatSalonDateTime = (locale: Locale, instant: Date) =>
  formatSalon(locale, instant, { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' });

/**
 * A calendar day given as YYYY-MM-DD (no instant). Formatted at UTC noon in
 * UTC so the label is that day regardless of any timezone.
 */
export function formatCalendarDay(locale: Locale, day: string, options: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(HTML_LANG[locale], { timeZone: 'UTC', ...options }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Month name for a 1-12 month number. */
export function formatMonth(locale: Locale, year: number, month: number, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(HTML_LANG[locale], { timeZone: 'UTC', year: 'numeric', month: style }).format(new Date(Date.UTC(year, month - 1, 15)));
}

/** Month name alone: "March" / "3月". */
export function formatMonthName(locale: Locale, month: number, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(HTML_LANG[locale], { timeZone: 'UTC', month: style }).format(new Date(Date.UTC(2000, month - 1, 15)));
}
