// Pure rendering of a booking as a Google Calendar event
// (docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md §5).
// No database, no Google call: the caller decides who is erased and which
// language and colour to use.

import { createHash } from 'node:crypto';
import { formatInTimeZone } from 'date-fns-tz';
import type { Locale } from '@/i18n/config';
import { formatSalonClock, formatSalonLongDate } from '@/i18n/dates';
import { translator } from '@/i18n/messages';
import { formatGBP } from './pricing/money';
import { SALON_TIMEZONE } from './salon-time';
import type { GoogleEvent } from './google-calendar-gateway';

export const GOOGLE_APPOINTMENT_PROPERTY = 'harbourAppointmentId';

const COLOR_COUNT = 11;
const LOCAL_ISO = "yyyy-MM-dd'T'HH:mm:ssXXX";

/** 'hh' + 40 hex digits: Google event ids allow a-v and 0-9 (base32hex), and hex is a subset. */
export function googleEventIdFor(appointmentId: string): string {
  return 'hh' + createHash('sha256').update(`harbour-appointment:${appointmentId}`).digest('hex').slice(0, 40);
}

export type RenderableAppointment = {
  id: string; date: Date; status: string; notes: string | null; durationMin: number;
  customer: { name: string | null; phone: string | null; erased: boolean };
  stylist: { id: string; name: string }; serviceName: string;
  deposit: { state: string; amountPence: number } | null;
  /** The new time the customer asked for; the booking keeps its own time until staff approve. */
  rescheduleRequestedDate?: Date | null;
};

/** Titles are one line: free text (names, services) never breaks the layout. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Free text as written and compared: \n line endings, no trailing whitespace on
 * any line. Narrow on purpose (HTML is never stripped): a difference beyond
 * this is a real edit.
 */
function canonicalText(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trimEnd()).join('\n').trim();
}

export function renderGoogleEvent(
  appt: RenderableAppointment,
  ctx: { locale: Locale; adminDayUrl: string; colorId: string },
): { event: GoogleEvent; hash: string } {
  const t = translator(ctx.locale, 'emails');
  const customerName = oneLine(appt.customer.name ?? '') || t('googleCalendar.nameNotGiven');
  const title = [oneLine(appt.stylist.name), customerName, oneLine(appt.serviceName)].join(' · ');
  const summary = appt.status === 'PENDING' ? `${t('googleCalendar.request')} ${title}` : title;

  const lines: string[] = [];
  const phone = appt.customer.erased ? '' : (appt.customer.phone ?? '').trim();
  if (phone) lines.push(t('googleCalendar.phone', { phone }));
  const notes = canonicalText(appt.notes ?? '');
  if (notes && !appt.customer.erased) lines.push(t('googleCalendar.notes', { notes }));
  lines.push(t('googleCalendar.status.label', {
    status: t.dynamic(`googleCalendar.status.${appt.status}`, undefined, appt.status),
  }));
  // Only a confirmed booking carries an open request (every other status change clears it).
  if (appt.rescheduleRequestedDate && appt.status === 'CONFIRMED') {
    const requested = appt.rescheduleRequestedDate;
    lines.push(t('googleCalendar.rescheduleRequest', {
      when: `${formatSalonLongDate(ctx.locale, requested)} ${formatSalonClock(ctx.locale, requested)}`,
    }));
  }
  if (appt.deposit && appt.deposit.amountPence > 0) {
    const amount = formatGBP(appt.deposit.amountPence, ctx.locale);
    lines.push(t('googleCalendar.deposit.label', {
      state: t.dynamic(`googleCalendar.deposit.${appt.deposit.state}`, { amount }, `${appt.deposit.state} ${amount}`),
    }));
  }
  lines.push(t('googleCalendar.adminLink', { url: ctx.adminDayUrl }));
  lines.push('', t('googleCalendar.editWarning'));

  const end = new Date(appt.date.getTime() + appt.durationMin * 60_000);
  const event: GoogleEvent = {
    id: googleEventIdFor(appt.id),
    status: 'confirmed',
    summary,
    description: lines.join('\n'),
    start: { dateTime: formatInTimeZone(appt.date, SALON_TIMEZONE, LOCAL_ISO), timeZone: SALON_TIMEZONE },
    end: { dateTime: formatInTimeZone(end, SALON_TIMEZONE, LOCAL_ISO), timeZone: SALON_TIMEZONE },
    transparency: 'opaque',
    colorId: ctx.colorId,
    extendedProperties: { private: { [GOOGLE_APPOINTMENT_PROPERTY]: appt.id } },
  };
  return { event, hash: hashEvent(event) };
}

/** Canonical JSON with a fixed key order, so the hash never depends on object construction. */
function hashEvent(event: GoogleEvent): string {
  const canonical = JSON.stringify([
    event.summary ?? null, event.description ?? null,
    event.start?.dateTime ?? event.start?.date ?? null, event.start?.timeZone ?? null,
    event.end?.dateTime ?? event.end?.date ?? null, event.end?.timeZone ?? null,
    event.colorId ?? null, event.status ?? null, event.transparency ?? null,
    Object.entries(event.extendedProperties?.private ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Stylists get Google's colours 1..11 by their sorted ids, cycling. */
export function stylistColorId(stylistIds: string[], stylistId: string): string {
  const index = [...stylistIds].sort().indexOf(stylistId);
  return String((index < 0 ? 0 : index) % COLOR_COUNT + 1);
}

function instant(time: GoogleEvent['start']): number | null {
  if (!time?.dateTime) return null;
  const ms = Date.parse(time.dateTime);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whether a listed event still reads as the rendered one. Only what staff can
 * edit in Google counts (text, time, colour, deleted); Google's own bookkeeping
 * (etag, updated, sequence) never does. Instants are compared, not strings;
 * text after canonicalText on both sides (line endings, trailing spaces).
 */
export function sameRenderedEvent(listed: GoogleEvent, expected: GoogleEvent): boolean {
  if ((listed.status === 'cancelled') !== (expected.status === 'cancelled')) return false;
  if (canonicalText(listed.summary ?? '') !== canonicalText(expected.summary ?? '')) return false;
  if (canonicalText(listed.description ?? '') !== canonicalText(expected.description ?? '')) return false;
  if ((listed.colorId ?? '') !== (expected.colorId ?? '')) return false;
  const [ls, le, es, ee] = [instant(listed.start), instant(listed.end), instant(expected.start), instant(expected.end)];
  return ls !== null && le !== null && ls === es && le === ee;
}
