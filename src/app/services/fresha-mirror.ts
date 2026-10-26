// Fresha → Google, the "A2 mirror"
// (docs/superpowers/specs/2026-10-26-fresha-watch-and-google-mirror-design.md):
// the busy times in a stylist's Fresha export, copied into a SEPARATE Google
// calendar that the website never reads back. Never into the salon calendar
// (GOOGLE_CALENDAR_ID): its pull would import the copies as the salon's own
// busy time and send them back to Fresha (lib/google-calendar-config.ts
// refuses that setup). No database. Never call this inside a transaction.

import { createHash } from 'node:crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { isGoogleColorId } from '@/app/lib/calendar-colors';
import type { Locale } from '@/i18n/config';
import { translator } from '@/i18n/messages';
import { busyKindOf } from './calendar-busy-kind';
import type { CalendarBusyInterval } from './calendar-ical';
import { sameRenderedEvent } from './google-calendar-event';
import { GoogleCalendarError, type createGoogleCalendarGateway, type GoogleEvent } from './google-calendar-gateway';
import { SALON_TIMEZONE } from './salon-time';

/** Marks the website's copy of one Fresha connection's busy time; its value is the connection id. */
export const FRESHA_MIRROR_PROPERTY = 'harbourFreshaMirror';

const LOCAL_ISO = "yyyy-MM-dd'T'HH:mm:ssXXX";

export type FreshaMirrorGateway = Pick<ReturnType<typeof createGoogleCalendarGateway>, 'listEvents' | 'putEvent' | 'insertEvent' | 'deleteEvent'>;
export type FreshaMirrorConnection = { id: string; stylistName: string; googleColorId: string | null };
export type FreshaMirrorResult = { written: number; deleted: number; unchanged: number; complete: boolean };

/**
 * 'hf' + 40 hex digits (hex is a subset of Google's base32hex ids), one per
 * connection and Fresha UID, so a rerun after a cut-off writes the same events
 * again instead of adding copies. Distinct from the bookings' 'hh' ids.
 */
export function freshaMirrorEventId(connectionId: string, uid: string): string {
  return 'hf' + createHash('sha256').update(`harbour-fresha:${connectionId}:${uid}`).digest('hex').slice(0, 40);
}

/**
 * One Fresha busy time as its Google copy. Fresha's export carries only the
 * generic titles ("Fresha Appointment" / "Fresha Blocked Time", never a
 * customer's details), so the copy says which of the two it is and whose time.
 */
export function renderFreshaMirrorEvent(connection: FreshaMirrorConnection, interval: CalendarBusyInterval, locale: Locale): GoogleEvent {
  const t = translator(locale, 'emails');
  const kind = busyKindOf(interval.summary);
  const what = kind === 'booking' ? t('freshaMirror.booking') : kind === 'blocked' ? t('freshaMirror.blocked') : t('freshaMirror.busy');
  return {
    id: freshaMirrorEventId(connection.id, interval.uid),
    status: 'confirmed',
    summary: `${connection.stylistName.replace(/\s+/g, ' ').trim()} · ${what}`,
    description: t('freshaMirror.description'),
    start: { dateTime: formatInTimeZone(interval.start, SALON_TIMEZONE, LOCAL_ISO), timeZone: SALON_TIMEZONE },
    end: { dateTime: formatInTimeZone(interval.end, SALON_TIMEZONE, LOCAL_ISO), timeZone: SALON_TIMEZONE },
    transparency: 'opaque',
    // The stylist's Google colour, so the copies read like the salon's own entries.
    ...(isGoogleColorId(connection.googleColorId) ? { colorId: connection.googleColorId } : {}),
    extendedProperties: { private: { [FRESHA_MIRROR_PROPERTY]: connection.id } },
  };
}

function mirrorOf(event: GoogleEvent): string | undefined {
  return event.extendedProperties?.private?.[FRESHA_MIRROR_PROPERTY];
}

/**
 * Makes the mirror calendar hold exactly this connection's current Fresha busy
 * times from `now` to `windowEnd`: writes the new and changed ones (a copy
 * someone edited or deleted in Google is written back), deletes the future
 * copies Fresha no longer has, and leaves the past alone. Stops writing after
 * `deadline` and answers `complete: false`; the next run picks up from there.
 * A Google error is thrown (GoogleCalendarError) for the caller to classify.
 */
export async function reconcileFreshaMirror(input: {
  gateway: FreshaMirrorGateway;
  connection: FreshaMirrorConnection;
  intervals: readonly CalendarBusyInterval[];
  locale: Locale;
  now: Date;
  windowEnd: Date;
  deadline: number;
  clock?: () => number;
}): Promise<FreshaMirrorResult> {
  const clock = input.clock ?? Date.now;
  // The whole mirror calendar, deleted copies included (an id Google still
  // holds as deleted refuses an insert, so it is written back with a PUT).
  const listed = new Map((await input.gateway.listEvents({ timeMin: input.now, timeMax: input.windowEnd })).map((event) => [event.id, event]));
  const result: FreshaMirrorResult = { written: 0, deleted: 0, unchanged: 0, complete: true };
  const wanted = new Set<string>();
  for (const interval of input.intervals) {
    const event = renderFreshaMirrorEvent(input.connection, interval, input.locale);
    wanted.add(event.id);
    const current = listed.get(event.id);
    if (current && sameRenderedEvent(current, event) && mirrorOf(current) === input.connection.id) {
      result.unchanged += 1;
      continue;
    }
    if (clock() > input.deadline) return { ...result, complete: false };
    if (current) await input.gateway.putEvent(event);
    else {
      try {
        await input.gateway.insertEvent(event);
      } catch (error) {
        // The id exists outside the listed window (or was created since): write it in place.
        if (!(error instanceof GoogleCalendarError && error.kind === 'conflict')) throw error;
        await input.gateway.putEvent(event);
      }
    }
    result.written += 1;
  }
  for (const event of listed.values()) {
    if (event.status === 'cancelled' || mirrorOf(event) !== input.connection.id || wanted.has(event.id)) continue;
    if (clock() > input.deadline) return { ...result, complete: false };
    await input.gateway.deleteEvent(event.id);
    result.deleted += 1;
  }
  return result;
}
