import 'server-only';

// Website → Google (docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md §5, §7, §9):
// writes each booking in the window to the salon's Google Calendar and deletes
// the event once the booking is cancelled, or (mode 'all') 12 months after the
// appointment ended. Explicit ids (erasure, an old cancellation) and rows the
// website still owes Google (a failed write, for its first five attempts, or
// one erasure marked for re-rendering, until it lands) reach past the window
// up to that 12-month limit, but only to update or delete an event that is
// still live. Google is never called inside
// a database transaction, and one booking's failure is recorded on its row,
// never thrown. A setup failure (Google refusing the website's own access, or
// the sync switched off mid-run) stops the run instead: every other booking
// would fail the same way, so it is recorded on that one row and reported once
// (`stopped: 'setup'`) for the job row.
// Diary mirror (docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md §8):
// each event takes its stylist's Google colour, else the no-stylist colour; and
// before any booking is chosen, the calendar change guard (services/google-calendar-guard.ts)
// clears the rows once when GOOGLE_CALENDAR_ID names another calendar than the
// one they were written to, so every booking is written to the configured one.

import type { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_UNASSIGNED_COLOR_ID, isGoogleColorId } from '@/app/lib/calendar-colors';
import { googleCalendarConfig } from '@/app/lib/google-calendar-config';
import { isErasedEmail } from '@/app/lib/customer-erasure';
import { depositView, depositViewSelect } from '@/app/lib/deposit-display';
import { SITE_URL } from '@/app/lib/site-url';
import { isLocale, type Locale } from '@/i18n/config';
import { localizeHref } from '@/i18n/paths';
import type { ContentFields } from './content/fields';
import { loadPublishedTranslations } from './content/translations';
import { createGoogleCalendarGateway, GoogleCalendarError, type GoogleEvent } from './google-calendar-gateway';
import { googleColorFor, googleEventIdFor, renderGoogleEvent } from './google-calendar-event';
import { guardGoogleCalendarChange } from './google-calendar-guard';
import { OPERATIONS_MESSAGES } from './operations-messages';
import { salonDateKey, salonDayWindow } from './salon-time';

/** 'recent' runs take at most this many; explicit ids and 'all' page through in batches this size. */
const MAX_PER_RUN = 100;
/** No new write starts after this (nor a new batch); Vercel functions are cut off soon after. */
const TIME_BUDGET_MS = 40_000;
/**
 * 'recent' mode: bookings changed this recently are re-rendered. Longer than
 * the half-hourly calendar-sync cadence, so a change made between two runs
 * (a lapse by the notifications cron, on the same :00/:30 ticks) is never missed.
 */
const RECENT_MS = 45 * 60_000;
/** No booking lasts a day: one starting this long before the retention cutoff has certainly ended before it. */
const RETENTION_QUERY_MARGIN_MS = 24 * 60 * 60_000;
/** Outbound window: from salon-local midnight this many days back. */
const WINDOW_DAYS = 7;
/**
 * The Google copy is a working diary: deleted this many months after the
 * appointment ended (owner decision). The privacy notice states it
 * (messages/{en,zh}/legal.ts, retention.googleCalendar; a page test pins it).
 */
export const GOOGLE_RETENTION_MONTHS = 12;
/**
 * Before the window a failed write is retried by the runs only this many
 * times (it stays counted as failing on Admin → Integrations); inside the
 * window, or once erasure marks it, it is retried until it lands.
 */
const OWED_RETRY_ATTEMPTS = 5;

/** Only what the push needs; the full gateway satisfies it. */
export type GoogleGateway = Pick<ReturnType<typeof createGoogleCalendarGateway>, 'putEvent' | 'insertEvent' | 'deleteEvent'>;

/** `stopped: 'setup'`: Google refused the website's access (or the sync was switched off), so the run stopped early. */
export type GooglePushResult = { written: number; deleted: number; unchanged: number; failed: number; skipped?: 'disabled'; stopped?: 'setup' };

type Outcome = 'written' | 'deleted' | 'unchanged' | 'failed' | 'skipped';

/** What rendering a booking needs (shared with the pull's revert, services/google-calendar-pull.ts). */
export const appointmentSelect = {
  id: true, date: true, status: true, notes: true, durationAtBooking: true,
  user: { select: { name: true, phone: true, email: true } },
  stylist: { select: { id: true, name: true, googleColorId: true } },
  service: { select: { id: true, name: true, duration: true } },
  rescheduleRequestedDate: true,
  paymentAttempt: { select: depositViewSelect },
  googleCalendarEvent: { select: { eventId: true, syncedHash: true, syncedAt: true, removed: true, lastError: true } },
} satisfies Prisma.AppointmentSelect;
export type PushAppointment = Prisma.AppointmentGetPayload<{ select: typeof appointmentSelect }>;

export type RenderContext = { locale: Locale; unassignedColorId: string; serviceFields: Map<string, ContentFields> };

/** Salon-local midnight WINDOW_DAYS calendar days back: counted in days, not 24-hour steps, so DST cannot shift it. */
export function windowStart(now: Date): Date {
  const day = new Date(`${salonDateKey(now)}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - WINDOW_DAYS);
  return salonDayWindow(day).start;
}

function retentionCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - GOOGLE_RETENTION_MONTHS);
  return cutoff;
}

/** When the appointment ended: start + booked duration (the service's when none was recorded). */
function endTime(appointment: { date: Date; durationAtBooking: number | null; service: { duration: number } }): number {
  return appointment.date.getTime() + (appointment.durationAtBooking ?? appointment.service.duration) * 60_000;
}

function selection(now: Date, mode: 'recent' | 'all', appointmentIds?: string[]): Prisma.AppointmentWhereInput {
  // The 12-month retention limit, in the query (no row past it fills a batch); exact per row after.
  const retained: Prisma.AppointmentWhereInput = { date: { gte: new Date(retentionCutoff(now).getTime() - RETENTION_QUERY_MARGIN_MS) } };
  // Explicit ids reach past the window (erasure re-renders, old cancellations delete).
  if (appointmentIds) return { id: { in: appointmentIds }, ...retained };
  const inWindow: Prisma.AppointmentWhereInput = { date: { gte: windowStart(now) } };
  // What the website still owes Google, back to the retention limit rather than the window:
  //   - a row marked for re-rendering: erasure clears syncedHash of a written event (syncedAt
  //     set) in its own transaction, so a push that failed or never ran is repaired by the next
  //     run, however often Google refused it, until the 12-month limit deletes the copy;
  //   - a failed write: in the window until it lands, before it for OWED_RETRY_ATTEMPTS only, so
  //     a booking Google keeps refusing is not sent every half hour for a year. A row a failed
  //     first write created (no hash, never synced) is such a failure, not an erasure.
  const owed: Prisma.AppointmentWhereInput = {
    ...retained,
    OR: [
      { googleCalendarEvent: { is: { syncedHash: null, syncedAt: { not: null }, removed: false } } },
      { googleCalendarEvent: { is: { lastError: { not: null }, attempts: { lt: OWED_RETRY_ATTEMPTS } } } },
      { ...inWindow, googleCalendarEvent: { is: { lastError: { not: null } } } },
    ],
  };
  if (mode === 'all') return { OR: [inWindow, owed] };
  return {
    OR: [
      {
        ...inWindow,
        OR: [
          { updatedAt: { gte: new Date(now.getTime() - RECENT_MS) } },
          // A cancelled booking never written has nothing to delete: leave it out, or it is picked every run.
          { googleCalendarEvent: { is: null }, status: { not: 'CANCELLED' } },
        ],
      },
      owed,
    ],
  };
}

export async function loadRenderContext(db: PrismaClient, appointments: PushAppointment[]): Promise<RenderContext> {
  // The salon's own diary: its notification language (default Traditional Chinese) and the
  // no-stylist colour (Admin → Integrations), read from the live row.
  const settings = await db.siteSettings.findUnique({
    where: { id: 'singleton' },
    select: { salonNotificationLocale: true, googleUnassignedColorId: true },
  });
  const locale: Locale = isLocale(settings?.salonNotificationLocale) ? settings.salonNotificationLocale : 'zh-HK';
  const unassignedColorId = isGoogleColorId(settings?.googleUnassignedColorId) ? settings.googleUnassignedColorId : DEFAULT_UNASSIGNED_COLOR_ID;
  const serviceFields = await loadPublishedTranslations(db, 'SERVICE', appointments.map((appointment) => appointment.service.id), locale);
  return { locale, unassignedColorId, serviceFields };
}

export function renderAppointment(appointment: PushAppointment, context: RenderContext) {
  const translated = context.serviceFields.get(appointment.service.id)?.name;
  const serviceName = typeof translated === 'string' && translated.trim() ? translated : appointment.service.name;
  const adminDayUrl = `${SITE_URL}${localizeHref(context.locale, '/admin')}?date=${salonDateKey(appointment.date)}&view=day`;
  return renderGoogleEvent({
    id: appointment.id,
    date: appointment.date,
    status: appointment.status,
    notes: appointment.notes,
    durationMin: appointment.durationAtBooking ?? appointment.service.duration,
    customer: { name: appointment.user.name, phone: appointment.user.phone, erased: isErasedEmail(appointment.user.email) },
    stylist: { id: appointment.stylist.id, name: appointment.stylist.name },
    serviceName,
    deposit: depositView(appointment.paymentAttempt),
    rescheduleRequestedDate: appointment.rescheduleRequestedDate,
  }, { locale: context.locale, adminDayUrl, colorId: googleColorFor(appointment.stylist, context.unassignedColorId) });
}

function errorKind(error: unknown): GoogleCalendarError['kind'] | null {
  return error instanceof GoogleCalendarError ? error.kind : null;
}

/** The website's own setup, not this booking: every other write would fail the same way. */
function isSetupFailure(error: unknown): boolean {
  const kind = errorKind(error);
  return kind === 'auth' || kind === 'disabled';
}

/** PUT at the event's own id; 404 → insert with that id; 409 (the id exists, deleted) → PUT again. */
export async function writeEvent(gateway: GoogleGateway, event: GoogleEvent): Promise<void> {
  try {
    await gateway.putEvent(event);
    return;
  } catch (error) {
    if (errorKind(error) !== 'not_found') throw error;
  }
  try {
    await gateway.insertEvent(event);
    return;
  } catch (error) {
    if (errorKind(error) !== 'conflict') throw error;
  }
  await gateway.putEvent(event);
}

/** Keeps the last written hash: the next run (cron) writes the row again. */
export async function recordFailure(db: PrismaClient, appointmentId: string, eventId: string, error: unknown): Promise<Outcome> {
  const lastError = errorKind(error) === 'refused' ? OPERATIONS_MESSAGES.GOOGLE_PUSH_REFUSED : OPERATIONS_MESSAGES.GOOGLE_PUSH_FAILED;
  try {
    await db.googleCalendarEvent.upsert({
      where: { appointmentId },
      create: { appointmentId, eventId, attempts: 1, lastError },
      update: { attempts: { increment: 1 }, lastError },
    });
  } catch {
    // Counted as failed either way; the booking is picked again while it stays dirty.
  }
  return 'failed';
}

export async function pushGoogleCalendar(options: {
  db?: PrismaClient;
  now?: Date;
  gateway?: GoogleGateway;
  mode?: 'recent' | 'all';
  appointmentIds?: string[];
} = {}): Promise<GooglePushResult> {
  const result = { written: 0, deleted: 0, unchanged: 0, failed: 0 };
  // Kill-switch above the first database read (docs/agents/neon-budget.md).
  const config = googleCalendarConfig();
  if (!config) return { ...result, skipped: 'disabled' };
  if (options.appointmentIds && options.appointmentIds.length === 0) return result;
  const db = options.db ?? (await import('@/app/lib/prisma')).default;
  await guardGoogleCalendarChange(db, config.calendarId);
  const now = options.now ?? new Date();
  const gateway = options.gateway ?? createGoogleCalendarGateway();
  const mode = options.mode ?? 'recent';
  const reconcile = mode === 'all' && !options.appointmentIds;
  const from = windowStart(now);
  const cutoff = retentionCutoff(now).getTime();
  const startedAt = Date.now();
  let stopped = false;
  /** Within the time budget, and no setup failure yet. */
  const going = () => !stopped && Date.now() - startedAt < TIME_BUDGET_MS;
  const count = (outcome: Outcome) => {
    if (outcome !== 'skipped') result[outcome] += 1;
  };
  const finish = (): GooglePushResult => (stopped ? { ...result, stopped: 'setup' } : result);
  /** Records the booking's failure; a setup failure also stops the run. */
  const fail = (appointmentId: string, eventId: string, error: unknown): Promise<Outcome> => {
    if (isSetupFailure(error) && !stopped) {
      stopped = true;
      console.error('Google Calendar push stopped: Google refused the website\'s access', { kind: errorKind(error), status: (error as GoogleCalendarError).status });
    }
    return recordFailure(db, appointmentId, eventId, error);
  };

  const removeEvent = async (appointmentId: string, eventId: string): Promise<Outcome> => {
    if (!going()) return 'skipped';
    try {
      await gateway.deleteEvent(eventId);
    } catch (error) {
      return fail(appointmentId, eventId, error);
    }
    try {
      await db.googleCalendarEvent.update({
        where: { appointmentId },
        data: { removed: true, syncedHash: null, syncedAt: now, attempts: 0, lastError: null },
      });
    } catch {
      return 'failed';
    }
    return 'deleted';
  };

  const pushBatch = async (batch: PushAppointment[]) => {
    // Past the retention limit: housekeeping's 'all' run deletes these, nothing writes them again.
    const appointments = batch.filter((appointment) => endTime(appointment) >= cutoff);
    if (appointments.length === 0) return;
    const context = await loadRenderContext(db, appointments);
    for (const appointment of appointments) {
      if (stopped) return;
      const row = appointment.googleCalendarEvent;
      if (appointment.status === 'CANCELLED') {
        // Delete while live; also once more after a failed write (a timed-out PUT may have landed).
        // Google answers a delete of a missing event as done.
        count(row && (!row.removed || row.lastError !== null) ? await removeEvent(appointment.id, row.eventId) : 'unchanged');
        continue;
      }
      // Before the window (explicit ids, or a row still owed: a failed write, an erasure re-render):
      // update a live event, never create or re-create one.
      if (appointment.date < from && (!row || row.removed)) {
        count('unchanged');
        continue;
      }
      let rendered: ReturnType<typeof renderAppointment>;
      try {
        rendered = renderAppointment(appointment, context);
      } catch (error) {
        count(await recordFailure(db, appointment.id, googleEventIdFor(appointment.id), error));
        continue;
      }
      const { event, hash } = rendered;
      // After a failure the last hash proves nothing (a timed-out PUT may have landed): write again.
      if (row && !row.removed && row.lastError === null && row.syncedHash === hash) {
        count('unchanged');
        continue;
      }
      if (!going()) continue;
      try {
        await writeEvent(gateway, event);
      } catch (error) {
        count(await fail(appointment.id, event.id, error));
        continue;
      }
      const synced = { eventId: event.id, syncedHash: hash, syncedAt: now, removed: false, attempts: 0, lastError: null };
      try {
        await db.googleCalendarEvent.upsert({ where: { appointmentId: appointment.id }, create: { appointmentId: appointment.id, ...synced }, update: synced });
        count('written');
      } catch {
        count('failed');
      }
    }
  };

  if (mode === 'recent' && !options.appointmentIds) {
    // The most recently changed first; the rest wait for the next run.
    const appointments = await db.appointment.findMany({
      where: selection(now, mode),
      select: appointmentSelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: MAX_PER_RUN,
    });
    await pushBatch(appointments);
    return finish();
  }

  // 'all': retention first. Then, for 'all' and explicit ids alike, every selected booking in
  // (date, id) keyset batches until done or out of time: an erasure never stops at 100.
  let after: { date: Date; id: string } | null = null;
  while (reconcile && going()) {
    const page: { appointmentId: string; eventId: string; appointment: { date: Date; durationAtBooking: number | null; service: { duration: number } } }[] =
      await db.googleCalendarEvent.findMany({
        where: {
          removed: false,
          appointment: { date: { lt: new Date(cutoff) } },
          ...(after ? { OR: [{ appointment: { date: { gt: after.date } } }, { appointment: { date: after.date }, appointmentId: { gt: after.id } }] } : {}),
        },
        select: { appointmentId: true, eventId: true, appointment: { select: { date: true, durationAtBooking: true, service: { select: { duration: true } } } } },
        orderBy: [{ appointment: { date: 'asc' } }, { appointmentId: 'asc' }],
        take: MAX_PER_RUN,
      });
    for (const row of page) {
      if (endTime(row.appointment) < cutoff) count(await removeEvent(row.appointmentId, row.eventId));
    }
    if (page.length < MAX_PER_RUN) break;
    const last = page[page.length - 1];
    after = { date: last.appointment.date, id: last.appointmentId };
  }

  after = null;
  const selected = selection(now, mode, options.appointmentIds);
  while (going()) {
    const page: PushAppointment[] = await db.appointment.findMany({
      where: after ? { AND: [selected, { OR: [{ date: { gt: after.date } }, { date: after.date, id: { gt: after.id } }] }] } : selected,
      select: appointmentSelect,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: MAX_PER_RUN,
    });
    await pushBatch(page);
    if (page.length < MAX_PER_RUN) break;
    const last = page[page.length - 1];
    after = { date: last.date, id: last.id };
  }
  return finish();
}
