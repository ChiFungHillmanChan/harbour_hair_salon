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
  /** Block text colour; display tones use dark text. */
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

type GoogleSwatch = CalendarSwatch & {
  key: 'lavender' | 'sage' | 'grape' | 'flamingo' | 'banana' | 'tangerine' | 'peacock' | 'graphite' | 'blueberry' | 'basil' | 'tomato';
  hex: string;
};

/**
 * Google Calendar's eleven event colours (Google diary mirror, spec §3), so the
 * admin board shows the salon diary exactly as Google does. Admin-only, like
 * everything in this file. Arbitrary-value classes are written out in full,
 * one literal per colour, for the Tailwind reason at the top of this file.
 * `text` is whichever of white and zinc-950 reads better on the fill (both
 * clear WCAG AA); calendar-colors.test.ts recomputes it from `hex`.
 */
export const GOOGLE_EVENT_COLORS = {
  '1': { key: 'lavender', label: 'Lavender', hex: '#7986cb', fill: 'bg-[#7986cb]', text: 'text-zinc-950', stripe: 'bg-[#7986cb]', swatch: 'bg-[#7986cb]' },
  '2': { key: 'sage', label: 'Sage', hex: '#33b679', fill: 'bg-[#33b679]', text: 'text-zinc-950', stripe: 'bg-[#33b679]', swatch: 'bg-[#33b679]' },
  '3': { key: 'grape', label: 'Grape', hex: '#8e24aa', fill: 'bg-[#8e24aa]', text: 'text-white', stripe: 'bg-[#8e24aa]', swatch: 'bg-[#8e24aa]' },
  '4': { key: 'flamingo', label: 'Flamingo', hex: '#e67c73', fill: 'bg-[#e67c73]', text: 'text-zinc-950', stripe: 'bg-[#e67c73]', swatch: 'bg-[#e67c73]' },
  '5': { key: 'banana', label: 'Banana', hex: '#f6bf26', fill: 'bg-[#f6bf26]', text: 'text-zinc-950', stripe: 'bg-[#f6bf26]', swatch: 'bg-[#f6bf26]' },
  '6': { key: 'tangerine', label: 'Tangerine', hex: '#f4511e', fill: 'bg-[#f4511e]', text: 'text-zinc-950', stripe: 'bg-[#f4511e]', swatch: 'bg-[#f4511e]' },
  '7': { key: 'peacock', label: 'Peacock', hex: '#039be5', fill: 'bg-[#039be5]', text: 'text-zinc-950', stripe: 'bg-[#039be5]', swatch: 'bg-[#039be5]' },
  '8': { key: 'graphite', label: 'Graphite', hex: '#616161', fill: 'bg-[#616161]', text: 'text-white', stripe: 'bg-[#616161]', swatch: 'bg-[#616161]' },
  '9': { key: 'blueberry', label: 'Blueberry', hex: '#3f51b5', fill: 'bg-[#3f51b5]', text: 'text-white', stripe: 'bg-[#3f51b5]', swatch: 'bg-[#3f51b5]' },
  '10': { key: 'basil', label: 'Basil', hex: '#0b8043', fill: 'bg-[#0b8043]', text: 'text-white', stripe: 'bg-[#0b8043]', swatch: 'bg-[#0b8043]' },
  '11': { key: 'tomato', label: 'Tomato', hex: '#d50000', fill: 'bg-[#d50000]', text: 'text-white', stripe: 'bg-[#d50000]', swatch: 'bg-[#d50000]' },
} as const satisfies Record<string, GoogleSwatch>;

export type GoogleColorId = keyof typeof GOOGLE_EVENT_COLORS;

export const GOOGLE_COLOR_IDS = Object.keys(GOOGLE_EVENT_COLORS) as GoogleColorId[];

/** Spec §3 defaults: Tomato for bookings without a stylist, Graphite for leave. */
export const DEFAULT_UNASSIGNED_COLOR_ID: GoogleColorId = '11';
export const DEFAULT_LEAVE_COLOR_ID: GoogleColorId = '8';

/** An event with no colorId takes the calendar's own colour: a neutral grey here. */
export const GOOGLE_NO_COLOR: CalendarSwatch = {
  label: 'Calendar colour', fill: 'bg-zinc-300', text: 'text-zinc-950', stripe: 'bg-zinc-300', swatch: 'bg-zinc-300',
};

export function isGoogleColorId(value: unknown): value is GoogleColorId {
  return typeof value === 'string' && Object.hasOwn(GOOGLE_EVENT_COLORS, value);
}

export function googleEventSwatch(colorId: string | null | undefined): CalendarSwatch {
  return isGoogleColorId(colorId) ? GOOGLE_EVENT_COLORS[colorId] : GOOGLE_NO_COLOR;
}

/** A stylist's blocks on the board: their Google colour when set, so the board matches Google; else their calendar colour. */
export function stylistSwatch(stylist: { calendarColor: string | null; googleColorId?: string | null }): CalendarSwatch {
  return isGoogleColorId(stylist.googleColorId) ? GOOGLE_EVENT_COLORS[stylist.googleColorId] : resolveCalendarColor(stylist.calendarColor);
}

/** Pale board-only fills. Raw Google hex, colour ids and picker swatches above stay exact. */
const GOOGLE_DISPLAY_FILLS: Record<GoogleColorId, string> = {
  '1': 'bg-[#eef0fa]', '2': 'bg-[#eaf7ef]', '3': 'bg-[#f4eaf8]',
  '4': 'bg-[#fcefed]', '5': 'bg-[#fff8df]', '6': 'bg-[#fff0e8]',
  '7': 'bg-[#e8f5fc]', '8': 'bg-[#f0f0f0]', '9': 'bg-[#eceef8]',
  '10': 'bg-[#e8f3ec]', '11': 'bg-[#fcebec]',
};
const CALENDAR_DISPLAY_FILLS: Record<CalendarColorKey, string> = {
  slate: 'bg-slate-50', red: 'bg-red-50', amber: 'bg-amber-50', emerald: 'bg-emerald-50',
  teal: 'bg-teal-50', sky: 'bg-sky-50', indigo: 'bg-indigo-50', violet: 'bg-violet-50',
  fuchsia: 'bg-fuchsia-50', rose: 'bg-rose-50',
};

export function googleDisplaySwatch(colorId: string | null | undefined): CalendarSwatch {
  const raw = googleEventSwatch(colorId);
  return { ...raw, fill: isGoogleColorId(colorId) ? GOOGLE_DISPLAY_FILLS[colorId] : 'bg-zinc-50', text: 'text-zinc-950' };
}

export function stylistDisplaySwatch(stylist: { calendarColor: string | null; googleColorId?: string | null }): CalendarSwatch {
  if (isGoogleColorId(stylist.googleColorId)) return googleDisplaySwatch(stylist.googleColorId);
  const raw = resolveCalendarColor(stylist.calendarColor);
  return { ...raw, fill: isCalendarColorKey(stylist.calendarColor) ? CALENDAR_DISPLAY_FILLS[stylist.calendarColor] : 'bg-zinc-50', text: 'text-zinc-950', stripe: raw.swatch };
}
