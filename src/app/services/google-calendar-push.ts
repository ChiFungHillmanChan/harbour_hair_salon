import 'server-only';

// Website → Google (docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md §5, §7, §9):
// writes each booking in the window to the salon's Google Calendar and deletes
// the event once the booking is cancelled, or (mode 'all') 12 months after the
// appointment ended. Google is never called inside a database transaction, and
// one booking's failure is recorded on its row, never thrown.

import type { Prisma, PrismaClient } from '@prisma/client';
import { googleCalendarConfig } from '@/app/lib/google-calendar-config';
import { isErasedEmail } from '@/app/lib/customer-erasure';
import { depositView, depositViewSelect } from '@/app/lib/deposit-display';
import { SITE_URL } from '@/app/lib/site-url';
import { isLocale, type Locale } from '@/i18n/config';
import { localizeHref } from '@/i18n/paths';
import type { ContentFields } from './content/fields';
import { loadPublishedTranslations } from './content/translations';
import { createGoogleCalendarGateway, GoogleCalendarError, type GoogleEvent } from './google-calendar-gateway';
import { renderGoogleEvent, stylistColorId } from './google-calendar-event';
import { OPERATIONS_MESSAGES } from './operations-messages';
import { salonDateKey, salonDayWindow } from './salon-time';

const MAX_PER_RUN = 100;
/** No new write starts after this; Vercel functions are cut off soon after. */
const TIME_BUDGET_MS = 40_000;
/** 'recent' mode: bookings changed this recently are re-rendered. */
const RECENT_MS = 15 * 60_000;
/** Outbound window: from salon-local midnight this many days back. */
const WINDOW_DAYS = 7;
/** The Google copy is a working diary: deleted 12 months after the appointment ended (owner decision). */
const RETENTION_YEARS = 1;

/** Only what the push needs; the full gateway satisfies it. */
export type GoogleGateway = Pick<ReturnType<typeof createGoogleCalendarGateway>, 'putEvent' | 'insertEvent' | 'deleteEvent'>;

export type GooglePushResult = { written: number; deleted: number; unchanged: number; failed: number; skipped?: 'disabled' };

type Outcome = 'written' | 'deleted' | 'unchanged' | 'failed' | 'skipped';

/** What rendering a booking needs (shared with the pull's revert, services/google-calendar-pull.ts). */
export const appointmentSelect = {
  id: true, date: true, status: true, notes: true, durationAtBooking: true,
  user: { select: { name: true, phone: true, email: true } },
  stylist: { select: { id: true, name: true } },
  service: { select: { id: true, name: true, duration: true } },
  paymentAttempt: { select: depositViewSelect },
  googleCalendarEvent: { select: { eventId: true, syncedHash: true, removed: true, lastError: true } },
} satisfies Prisma.AppointmentSelect;
export type PushAppointment = Prisma.AppointmentGetPayload<{ select: typeof appointmentSelect }>;

export type RenderContext = { locale: Locale; stylistIds: string[]; serviceFields: Map<string, ContentFields> };

/** Salon-local midnight WINDOW_DAYS calendar days back: counted in days, not 24-hour steps, so DST cannot shift it. */
export function windowStart(now: Date): Date {
  const day = new Date(`${salonDateKey(now)}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - WINDOW_DAYS);
  return salonDayWindow(day).start;
}

function retentionCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - RETENTION_YEARS);
  return cutoff;
}

function selection(now: Date, mode: 'recent' | 'all', appointmentIds?: string[]): Prisma.AppointmentWhereInput {
  const inWindow: Prisma.AppointmentWhereInput = { date: { gte: windowStart(now) } };
  if (appointmentIds) return { ...inWindow, id: { in: appointmentIds } };
  if (mode === 'all') return inWindow;
  return {
    ...inWindow,
    OR: [
      { updatedAt: { gte: new Date(now.getTime() - RECENT_MS) } },
      // A cancelled booking never written has nothing to delete: leave it out, or it is picked every run.
      { googleCalendarEvent: { is: null }, status: { not: 'CANCELLED' } },
      { googleCalendarEvent: { is: { lastError: { not: null } } } },
    ],
  };
}

export async function loadRenderContext(db: PrismaClient, appointments: PushAppointment[]): Promise<RenderContext> {
  // The salon's own diary: its notification language, read from the live row (default Traditional Chinese).
  const settings = await db.siteSettings.findUnique({ where: { id: 'singleton' }, select: { salonNotificationLocale: true } });
  const locale: Locale = isLocale(settings?.salonNotificationLocale) ? settings.salonNotificationLocale : 'zh-HK';
  // Every stylist, retired ones included, so a retirement never shifts the others' colours.
  const stylists = await db.stylist.findMany({ select: { id: true } });
  const serviceFields = await loadPublishedTranslations(db, 'SERVICE', appointments.map((appointment) => appointment.service.id), locale);
  return { locale, stylistIds: stylists.map((stylist) => stylist.id), serviceFields };
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
  }, { locale: context.locale, adminDayUrl, colorId: stylistColorId(context.stylistIds, appointment.stylist.id) });
}

function errorKind(error: unknown): GoogleCalendarError['kind'] | null {
  return error instanceof GoogleCalendarError ? error.kind : null;
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
  // Kill-switch above the first database read (CLAUDE.md, "Neon compute budget").
  if (!googleCalendarConfig()) return { ...result, skipped: 'disabled' };
  if (options.appointmentIds && options.appointmentIds.length === 0) return result;
  const db = options.db ?? (await import('@/app/lib/prisma')).default;
  const now = options.now ?? new Date();
  const gateway = options.gateway ?? createGoogleCalendarGateway();
  const mode = options.mode ?? 'recent';
  const startedAt = Date.now();
  const withinBudget = () => Date.now() - startedAt < TIME_BUDGET_MS;
  const count = (outcome: Outcome) => {
    if (outcome !== 'skipped') result[outcome] += 1;
  };

  const removeEvent = async (appointmentId: string, eventId: string): Promise<Outcome> => {
    if (!withinBudget()) return 'skipped';
    try {
      await gateway.deleteEvent(eventId);
    } catch (error) {
      return recordFailure(db, appointmentId, eventId, error);
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

  let capacity = MAX_PER_RUN;
  if (mode === 'all' && !options.appointmentIds) {
    const cutoff = retentionCutoff(now);
    const candidates = await db.googleCalendarEvent.findMany({
      where: { removed: false, appointment: { date: { lt: cutoff } } },
      select: { appointmentId: true, eventId: true, appointment: { select: { date: true, durationAtBooking: true, service: { select: { duration: true } } } } },
      orderBy: { appointment: { date: 'asc' } },
      take: capacity,
    });
    const expired = candidates.filter(({ appointment }) => {
      const minutes = appointment.durationAtBooking ?? appointment.service.duration;
      return appointment.date.getTime() + minutes * 60_000 < cutoff.getTime();
    });
    capacity -= expired.length;
    for (const row of expired) count(await removeEvent(row.appointmentId, row.eventId));
  }
  if (capacity <= 0) return result;

  const appointments = await db.appointment.findMany({
    where: selection(now, mode, options.appointmentIds),
    select: appointmentSelect,
    orderBy: mode === 'all' && !options.appointmentIds ? [{ date: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: capacity,
  });
  if (appointments.length === 0) return result;
  const context = await loadRenderContext(db, appointments);

  for (const appointment of appointments) {
    const row = appointment.googleCalendarEvent;
    if (appointment.status === 'CANCELLED') {
      if (!row) {
        count('unchanged');
      } else if (!row.removed) {
        count(await removeEvent(appointment.id, row.eventId));
      } else {
        // Already deleted. A write that failed before it was cancelled again leaves nothing to retry.
        if (row.lastError !== null) {
          await db.googleCalendarEvent.update({ where: { appointmentId: appointment.id }, data: { attempts: 0, lastError: null } }).catch(() => undefined);
        }
        count('unchanged');
      }
      continue;
    }

    const { event, hash } = renderAppointment(appointment, context);
    // After a failure the last hash proves nothing (a timed-out PUT may have landed): write again.
    if (row && !row.removed && row.lastError === null && row.syncedHash === hash) {
      count('unchanged');
      continue;
    }
    if (!withinBudget()) continue;
    try {
      await writeEvent(gateway, event);
    } catch (error) {
      count(await recordFailure(db, appointment.id, event.id, error));
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
  return result;
}
