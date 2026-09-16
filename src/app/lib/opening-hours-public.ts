/**
 * The salon's published opening hours — ONE definition for the whole site.
 *
 * These times previously sat hardcoded in four places (the home and contact
 * JSON-LD blocks, the contact page's day list and the footer) and had drifted
 * apart from the marketplace listings. Google weighs NAP consistency — name,
 * address, phone and hours agreeing wherever the business appears — so a site
 * that contradicts its own Treatwell page is competing against itself in local
 * search, and a customer can turn up to a closed salon.
 *
 * Verified against treatwell.co.uk on 2026-09-16. If the salon changes its
 * hours, change them HERE and update Google Business Profile, Treatwell and
 * Fresha to match; `opening-hours-public.test.ts` fails if a page reintroduces
 * its own copy.
 *
 * Note this is the *marketing* opening time, which is not the same thing as
 * `Availability` in the database. That table drives which slots are bookable
 * per stylist and is edited in Admin -> Opening hours; a stylist may start
 * later than the salon door opens.
 */

export type PublicOpeningDay = {
  /** Schema.org day name, also used as the display label. */
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  opens: string;
  closes: string;
};

export const PUBLIC_OPENING_HOURS: readonly PublicOpeningDay[] = [
  { day: 'Monday', opens: '10:15', closes: '19:00' },
  { day: 'Tuesday', opens: '10:15', closes: '19:00' },
  { day: 'Wednesday', opens: '10:15', closes: '19:00' },
  { day: 'Thursday', opens: '10:15', closes: '19:00' },
  { day: 'Friday', opens: '10:15', closes: '19:00' },
  { day: 'Saturday', opens: '10:15', closes: '19:00' },
  { day: 'Sunday', opens: '10:30', closes: '17:30' },
] as const;

export type OpeningHoursSpecification = {
  '@type': 'OpeningHoursSpecification';
  dayOfWeek: string[];
  opens: string;
  closes: string;
};

/**
 * Consecutive days sharing the same times, collapsed into one entry — the shape
 * both the JSON-LD and the human-readable summaries want.
 */
export function groupedOpeningHours(): { days: PublicOpeningDay['day'][]; opens: string; closes: string }[] {
  const groups: { days: PublicOpeningDay['day'][]; opens: string; closes: string }[] = [];
  for (const entry of PUBLIC_OPENING_HOURS) {
    const last = groups[groups.length - 1];
    if (last && last.opens === entry.opens && last.closes === entry.closes) last.days.push(entry.day);
    else groups.push({ days: [entry.day], opens: entry.opens, closes: entry.closes });
  }
  return groups;
}

/** `openingHoursSpecification` for schema.org LocalBusiness/HairSalon. */
export function openingHoursSpecification(): OpeningHoursSpecification[] {
  return groupedOpeningHours().map((group) => ({
    '@type': 'OpeningHoursSpecification' as const,
    dayOfWeek: [...group.days],
    opens: group.opens,
    closes: group.closes,
  }));
}

/** e.g. "Mon – Sat" / "Sun", for the compact footer listing. */
export function shortDayRange(days: PublicOpeningDay['day'][]): string {
  const short = (day: PublicOpeningDay['day']) => day.slice(0, 3);
  return days.length === 1 ? short(days[0]) : `${short(days[0])} – ${short(days[days.length - 1])}`;
}

/** e.g. "10:15 – 19:00", the single display format used across the site. */
export function formatRange(opens: string, closes: string): string {
  return `${opens} – ${closes}`;
}

/** One sentence covering every group, for FAQ answers and meta descriptions. */
export function openingHoursSentence(): string {
  const parts = groupedOpeningHours().map((group) => {
    const days = group.days.length === 1
      ? group.days[0]
      : `${group.days[0]} to ${group.days[group.days.length - 1]}`;
    return `${days} from ${group.opens} to ${group.closes}`;
  });
  return `We are open ${parts.join(', and on ')}.`;
}
