/**
 * The admin calendar palette.
 *
 * Scope: these colours exist ONLY inside /admin. The public site is deliberately
 * monochrome (black/white/grey) at the client's request — no public page selects
 * `calendarColor`, and none should start.
 *
 * Every class name below is written out in full. Tailwind v4 discovers classes by
 * scanning source text, so a name assembled at runtime (`bg-${key}-600`) is never
 * emitted into the stylesheet: it looks correct in dev and ships as an unstyled
 * block in production. calendar-colors.test.ts guards this.
 *
 * Fills sit at the -600 level so white text clears WCAG AA on every swatch, and
 * stripes at -300 so a service colour stays visible against any fill.
 */

export type CalendarSwatch = {
  label: string;
  /** Block background. */
  fill: string;
  /** Block text colour — white on every swatch. */
  text: string;
  /** The service stripe drawn on top of a fill. */
  stripe: string;
  /** The picker button's own colour. */
  swatch: string;
};

export const CALENDAR_COLORS = {
  slate: { label: 'Slate', fill: 'bg-slate-600', text: 'text-white', stripe: 'bg-slate-300', swatch: 'bg-slate-600' },
  red: { label: 'Red', fill: 'bg-red-600', text: 'text-white', stripe: 'bg-red-300', swatch: 'bg-red-600' },
  amber: { label: 'Amber', fill: 'bg-amber-600', text: 'text-white', stripe: 'bg-amber-300', swatch: 'bg-amber-600' },
  emerald: { label: 'Emerald', fill: 'bg-emerald-600', text: 'text-white', stripe: 'bg-emerald-300', swatch: 'bg-emerald-600' },
  teal: { label: 'Teal', fill: 'bg-teal-600', text: 'text-white', stripe: 'bg-teal-300', swatch: 'bg-teal-600' },
  sky: { label: 'Sky', fill: 'bg-sky-600', text: 'text-white', stripe: 'bg-sky-300', swatch: 'bg-sky-600' },
  indigo: { label: 'Indigo', fill: 'bg-indigo-600', text: 'text-white', stripe: 'bg-indigo-300', swatch: 'bg-indigo-600' },
  violet: { label: 'Violet', fill: 'bg-violet-600', text: 'text-white', stripe: 'bg-violet-300', swatch: 'bg-violet-600' },
  fuchsia: { label: 'Fuchsia', fill: 'bg-fuchsia-600', text: 'text-white', stripe: 'bg-fuchsia-300', swatch: 'bg-fuchsia-600' },
  rose: { label: 'Rose', fill: 'bg-rose-600', text: 'text-white', stripe: 'bg-rose-300', swatch: 'bg-rose-600' },
} as const satisfies Record<string, CalendarSwatch>;

export type CalendarColorKey = keyof typeof CALENDAR_COLORS;

export const CALENDAR_COLOR_KEYS = Object.keys(CALENDAR_COLORS) as CalendarColorKey[];

/** What an appointment looks like before anyone has assigned a colour — today's board. */
export const DEFAULT_CALENDAR_COLOR: CalendarSwatch = {
  label: 'Default',
  fill: 'bg-zinc-800',
  text: 'text-white',
  stripe: 'bg-zinc-400',
  swatch: 'bg-zinc-800',
};

export function isCalendarColorKey(value: unknown): value is CalendarColorKey {
  return typeof value === 'string' && value in CALENDAR_COLORS;
}

/**
 * Resolve a stored key to its swatch, falling back to the neutral treatment for
 * null, empty or retired keys — so pulling a colour out of the palette can never
 * break historic appointments.
 */
export function resolveCalendarColor(key: string | null | undefined): CalendarSwatch {
  return isCalendarColorKey(key) ? CALENDAR_COLORS[key] : DEFAULT_CALENDAR_COLOR;
}
