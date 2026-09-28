import type { Availability, CalendarConnection, Stylist } from '@prisma/client';
import { validateWeek } from './opening-hours';

/**
 * How stale a successful inbound sync may be before a connection stops counting
 * as covered — and, because `assertOnlineBookingReady` re-checks this on every
 * booking attempt, how long online booking survives without one.
 *
 * This MUST stay a comfortable multiple of the `/api/cron/calendar-sync`
 * schedule in `vercel.json` (every 30 minutes during buffered opening hours). At the original 45
 * minutes a single skipped run closed public booking for everyone until the
 * next success, and Vercel cron is explicitly best-effort: no exactly-once
 * guarantee and no automatic catch-up. Marketplace iCal endpoints are also slow
 * and occasionally rate-limited, so one late run is routine rather than
 * exceptional. 90 minutes is three 30-minute ticks — exactly the 3x minimum a
 * test enforces, so do not shorten it or slow the cron without raising it.
 * Closed-hours imports deliberately pause; do not exempt overnight data from
 * freshness checks, since marketplaces can still accept bookings overnight.
 *
 * The cost of widening it is the window in which a marketplace booking is not
 * yet visible to the site. That window was never really 45 minutes anyway —
 * Fresha documents up to ~15 minutes of its own propagation delay on top of our
 * polling interval — so this trades illusory precision for an outage mode that
 * was silent to the customer, who simply saw "online booking is closed".
 */
export const CALENDAR_FRESHNESS_MINUTES = 90;
export const CALENDAR_PROVIDERS = ['TREATWELL', 'FRESHA'] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];
export type CoverageStylist = Pick<Stylist, 'id' | 'name' | 'icalToken'> & {
  availabilities: Pick<Availability, 'dayOfWeek' | 'isOff' | 'startTime' | 'endTime'>[];
  calendarConnections: Pick<CalendarConnection, 'provider' | 'receivesBookings' | 'inboundUrl' | 'inboundEnabled' | 'outboundConfirmedAt' | 'lastSuccessAt' | 'lastError'>[];
};
/**
 * One setup check as a stable code, for showing it in the admin's language
 * (adminOps.readiness.calendar.<code>). Stylist names and provider codes are
 * raw values, never translated.
 */
export type CalendarIssueCode = 'NO_STYLISTS' | 'HOURS_INVALID' | 'PROVIDER_UNSUPPORTED' | 'INBOUND_NOT_FRESH' | 'OUTBOUND_UNCONFIRMED';
export type CalendarIssue = { code: CalendarIssueCode; params?: { stylist: string; provider?: string; minutes?: number } };
export type SyncCoverage = {
  inboundReady: boolean;
  outboundReady: boolean;
  missingInbound: number;
  missingOutbound: number;
  safeToEnableOnlineBooking: boolean;
  warning: string | null;
  /** English, for logs and existing callers. */
  blockers: string[];
  /** The same checks as codes, index for index with `blockers`. */
  issues: CalendarIssue[];
};
/** Configuration checks reduce risk; delayed calendar polling is never a reservation guarantee. */
export function evaluateSyncCoverage(input: { stylists: CoverageStylist[]; now?: Date }): SyncCoverage {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - CALENDAR_FRESHNESS_MINUTES * 60_000);
  const blockers: string[] = [];
  const issues: CalendarIssue[] = [];
  const block = (text: string, issue: CalendarIssue) => { blockers.push(text); issues.push(issue); };
  let missingInbound = 0;
  let missingOutbound = 0;
  if (!input.stylists.length) block('No stylists are set up yet.', { code: 'NO_STYLISTS' });
  for (const stylist of input.stylists) {
    if (!validateWeek(stylist.availabilities).ok) block(`${stylist.name}: opening hours are incomplete or invalid.`, { code: 'HOURS_INVALID', params: { stylist: stylist.name } });
    for (const connection of stylist.calendarConnections.filter((entry) => entry.receivesBookings)) {
      const label = `${stylist.name} / ${connection.provider}`;
      const params = { stylist: stylist.name, provider: connection.provider };
      if (!CALENDAR_PROVIDERS.includes(connection.provider as CalendarProvider)) {
        block(`${label}: this provider is not supported.`, { code: 'PROVIDER_UNSUPPORTED', params });
        missingInbound++; missingOutbound++;
        continue;
      }
      if (!connection.inboundEnabled || !connection.inboundUrl?.trim() || !connection.lastSuccessAt ||
          connection.lastSuccessAt < cutoff || connection.lastSuccessAt > now || connection.lastError) {
        missingInbound++;
        block(`${label}: enable and successfully test its inbound feed; the last success must be within ${CALENDAR_FRESHNESS_MINUTES} minutes and its latest attempt must not have failed.`,
          { code: 'INBOUND_NOT_FRESH', params: { ...params, minutes: CALENDAR_FRESHNESS_MINUTES } });
      }
      if (!stylist.icalToken || !connection.outboundConfirmedAt) {
        missingOutbound++;
        block(`${label}: confirm that its matching website busy feed has been subscribed to and checked in the provider calendar.`, { code: 'OUTBOUND_UNCONFIRMED', params });
      }
    }
  }
  return {
    inboundReady: input.stylists.length > 0 && missingInbound === 0,
    outboundReady: input.stylists.length > 0 && missingOutbound === 0,
    missingInbound, missingOutbound,
    safeToEnableOnlineBooking: blockers.length === 0,
    warning: blockers.length ? `Calendar setup needs attention: ${blockers.join(' ')}` : null,
    blockers,
    issues,
  };
}
