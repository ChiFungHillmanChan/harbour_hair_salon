import 'server-only';

// Google → website (docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md §6):
// lists the salon calendar, writes back any website event edited, moved or
// deleted in Google (the website wins, D6), and stores the salon's own
// Google-only events as GOOGLE busy blocks. Google is never called inside a
// database transaction, and a failure is recorded on the sync state, never thrown.

import type { PrismaClient } from '@prisma/client';
import { googleCalendarConfig } from '@/app/lib/google-calendar-config';
import { describeFault } from '@/app/lib/fault';
import { createGoogleCalendarGateway, GoogleCalendarError, type GoogleEvent } from './google-calendar-gateway';
import { googleEventIdFor, GOOGLE_APPOINTMENT_PROPERTY, sameRenderedEvent } from './google-calendar-event';
import { googleBusyBlocks, googleBusyHash, type GoogleBusyBlock } from './google-busy-mapping';
import {
  appointmentSelect, loadRenderContext, recordFailure, renderAppointment, windowStart, writeEvent,
} from './google-calendar-push';
import { invalidateStylistIcalFeedFromCron } from './stylist-ical-cache';
import { OPERATIONS_MESSAGES } from './operations-messages';

const DAY_MS = 24 * 60 * 60_000;
/** Inbound window: Google is listed from a day back to 90 days ahead. */
const LOOKBACK_MS = DAY_MS;
const LOOKAHEAD_MS = 90 * DAY_MS;
/** No new write-back starts after this; the outcome must still be recorded before Vercel cuts the function off. */
const TIME_BUDGET_MS = 40_000;
const BATCH_SIZE = 100;
const STATE_ID = 'singleton';
/** Bookings that keep an event in Google (a cancelled one has its event deleted). */
const OPEN_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED'];
/**
 * Loop breaker: within this long of the website's own write of the same
 * rendering, a listing that differs is not written back again. Either Google
 * changed the event itself (each write would bring another notification and
 * another write, forever) or someone edited it at once; the next push writes it.
 */
const REWRITE_HOLD_MS = 10 * 60_000;

/** Only what the pull needs; the full gateway satisfies it. */
export type GooglePullGateway = Pick<ReturnType<typeof createGoogleCalendarGateway>, 'listEvents' | 'putEvent' | 'insertEvent' | 'deleteEvent'>;

export type GooglePullResult = { reverted: number; blocks: number; changed: boolean; skipped?: 'disabled' };

function websiteAppointmentId(event: GoogleEvent): string | null {
  const id = event.extendedProperties?.private?.[GOOGLE_APPOINTMENT_PROPERTY];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** One block per stylist and event: a listing that repeats an event (pages shifting) cannot break the unique key. */
function distinct(blocks: GoogleBusyBlock[]): GoogleBusyBlock[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const key = `${block.stylistId}\n${block.externalUid}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Replaces every GOOGLE block in the window in one transaction, as the iCal
 * sync does: readers never see an empty calendar. Returns false when the set
 * equals the one last stored (no write at all).
 */
async function storeBusyBlocks(db: PrismaClient, blocks: GoogleBusyBlock[], now: Date): Promise<boolean> {
  const hash = googleBusyHash(blocks);
  const state = await db.googleCalendarSyncState.findUnique({ where: { id: STATE_ID }, select: { busyHash: true } });
  if (state?.busyHash === hash) return false;
  await db.$transaction(async (tx) => {
    await tx.externalBusyBlock.deleteMany({
      where: { source: 'GOOGLE', end: { gt: new Date(now.getTime() - LOOKBACK_MS) }, start: { lt: new Date(now.getTime() + LOOKAHEAD_MS) } },
    });
    for (let offset = 0; offset < blocks.length; offset += BATCH_SIZE) {
      const batch = blocks.slice(offset, offset + BATCH_SIZE);
      // An event stored before the window and moved into it keeps its key: drop the old row first.
      await tx.externalBusyBlock.deleteMany({ where: { source: 'GOOGLE', externalUid: { in: batch.map((block) => block.externalUid) } } });
      await tx.externalBusyBlock.createMany({
        data: batch.map((block) => ({
          source: 'GOOGLE', stylistId: block.stylistId, externalUid: block.externalUid,
          start: block.start, end: block.end, summary: null, lastSyncAt: now,
        })),
      });
    }
    await tx.googleCalendarSyncState.upsert({ where: { id: STATE_ID }, create: { id: STATE_ID, busyHash: hash }, update: { busyHash: hash } });
  }, { timeout: 15_000, maxWait: 5_000 });
  // The stylists' outbound feeds export GOOGLE blocks. A route handler cannot
  // updateTag; the feed's one-day safety net heals a failed drop.
  try {
    invalidateStylistIcalFeedFromCron();
  } catch (error) {
    console.error('Dropping the busy-feed cache after a Google Calendar pull failed:', describeFault(error));
  }
  return true;
}

/** Logs a bookkeeping write that failed after Google answered; the next push or pull repairs the row. */
function logRowFailure(appointmentId: string) {
  return (error: unknown) => {
    console.error('Recording a Google Calendar write-back failed:', { appointmentId, ...describeFault(error) });
  };
}

/**
 * Writes the booking's real state back over each website event changed,
 * moved away or deleted in Google (D6). Returns how many events were written
 * back. A failed write is recorded on the booking's row, which the next push retries.
 */
async function revertWebsiteEvents(
  db: PrismaClient, gateway: GooglePullGateway, events: GoogleEvent[], range: { timeMin: Date; timeMax: Date },
  now: Date, withinBudget: () => boolean,
): Promise<number> {
  // A deleted event may come back as its id and status alone: look events up by id.
  const listed = new Map(events.map((event) => [event.id, event]));
  // Only an event at the booking's own id is the website's: a copy made in Google carries the property too.
  const named = new Set<string>();
  for (const event of events) {
    const appointmentId = websiteAppointmentId(event);
    if (appointmentId && event.id === googleEventIdFor(appointmentId)) named.add(appointmentId);
  }
  const appointments = await db.appointment.findMany({
    where: {
      OR: [
        { id: { in: [...named] } },
        // Every open booking in the listed range whose event the website wrote: one missing from the
        // listing (or listed as deleted) was deleted, purged or moved out of the range in Google.
        {
          status: { in: OPEN_STATUSES },
          date: { gte: range.timeMin, lt: range.timeMax },
          googleCalendarEvent: { is: { removed: false, syncedHash: { not: null } } },
        },
      ],
    },
    select: appointmentSelect,
  });
  const from = windowStart(now);
  const open = appointments.filter((appointment) => OPEN_STATUSES.includes(appointment.status) && appointment.date >= from);
  const context = open.length > 0 ? await loadRenderContext(db, open) : null;

  let reverted = 0;
  for (const appointment of appointments) {
    const eventId = googleEventIdFor(appointment.id);
    const event = listed.get(eventId);
    if (appointment.status === 'CANCELLED') {
      if (!event || event.status === 'cancelled' || !withinBudget()) continue;
      try {
        await gateway.deleteEvent(eventId);
      } catch (error) {
        await recordFailure(db, appointment.id, eventId, error);
        continue;
      }
      reverted += 1;
      const removed = { removed: true, syncedHash: null, syncedAt: now, attempts: 0, lastError: null };
      await db.googleCalendarEvent.upsert({
        where: { appointmentId: appointment.id }, create: { appointmentId: appointment.id, eventId, ...removed }, update: removed,
      }).catch(logRowFailure(appointment.id));
      continue;
    }
    if (!context || !open.includes(appointment)) continue;
    let expected: ReturnType<typeof renderAppointment>;
    try {
      expected = renderAppointment(appointment, context);
    } catch (error) {
      await recordFailure(db, appointment.id, eventId, error);
      continue;
    }
    // Missing or deleted in Google counts as changed (sameRenderedEvent compares the deleted state).
    if (event && sameRenderedEvent(event, expected.event)) continue;
    const row = appointment.googleCalendarEvent;
    // Keyed on the hash: a real booking change since that write is never held back.
    if (row && !row.removed && row.syncedHash === expected.hash && row.syncedAt && now.getTime() - row.syncedAt.getTime() < REWRITE_HOLD_MS) {
      const notKept = { lastError: OPERATIONS_MESSAGES.GOOGLE_EVENT_NOT_KEPT };
      await db.googleCalendarEvent.upsert({
        where: { appointmentId: appointment.id },
        create: { appointmentId: appointment.id, eventId, ...notKept },
        update: notKept,
      }).catch(logRowFailure(appointment.id));
      continue;
    }
    if (!withinBudget()) continue;
    try {
      await writeEvent(gateway, expected.event);
    } catch (error) {
      await recordFailure(db, appointment.id, eventId, error);
      continue;
    }
    reverted += 1;
    const synced = { eventId, syncedHash: expected.hash, syncedAt: now, removed: false, attempts: 0, lastError: null };
    await db.googleCalendarEvent.upsert({
      where: { appointmentId: appointment.id }, create: { appointmentId: appointment.id, ...synced }, update: synced,
    }).catch(logRowFailure(appointment.id));
  }
  return reverted;
}

export async function pullGoogleCalendar(options: {
  db?: PrismaClient;
  now?: Date;
  gateway?: GooglePullGateway;
} = {}): Promise<GooglePullResult> {
  // Kill-switch above the first database read (CLAUDE.md, "Neon compute budget").
  if (!googleCalendarConfig()) return { reverted: 0, blocks: 0, changed: false, skipped: 'disabled' };
  const db = options.db ?? (await import('@/app/lib/prisma')).default;
  const now = options.now ?? new Date();
  const gateway = options.gateway ?? createGoogleCalendarGateway();
  const startedAt = Date.now();
  const withinBudget = () => Date.now() - startedAt < TIME_BUDGET_MS;
  const result: GooglePullResult = { reverted: 0, blocks: 0, changed: false };

  try {
    const range = { timeMin: new Date(now.getTime() - LOOKBACK_MS), timeMax: new Date(now.getTime() + LOOKAHEAD_MS) };
    const events = await gateway.listEvents(range);
    // Busy time first: it is what keeps the website from selling a taken chair,
    // and the write-backs after it are the slow part. Website events are never
    // blocks (googleBusyBlocks' echo guard).
    const stylists = await db.stylist.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    const blocks = distinct(googleBusyBlocks(events, stylists));
    result.changed = await storeBusyBlocks(db, blocks, now);
    result.blocks = blocks.length;
    result.reverted = await revertWebsiteEvents(db, gateway, events, range, now, withinBudget);
    const success = { lastPullAt: now, lastPullSuccessAt: now, lastPullError: null };
    await db.googleCalendarSyncState.upsert({ where: { id: STATE_ID }, create: { id: STATE_ID, ...success }, update: success });
  } catch (error) {
    console.error('Google Calendar pull failed:', {
      ...describeFault(error),
      ...(error instanceof GoogleCalendarError ? { kind: error.kind, status: error.status } : {}),
    });
    const failure = { lastPullAt: now, lastPullError: OPERATIONS_MESSAGES.GOOGLE_PULL_FAILED };
    await db.googleCalendarSyncState.upsert({ where: { id: STATE_ID }, create: { id: STATE_ID, ...failure }, update: failure }).catch(() => undefined);
  }
  return result;
}
