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
const OPEN_STATUSES = new Set(['PENDING', 'CONFIRMED', 'COMPLETED']);

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

/**
 * Writes the booking's real state back over each website event changed in
 * Google (D6). Returns how many events were written back. A failed write is
 * recorded on the booking's row, which the next push retries.
 */
async function revertWebsiteEvents(
  db: PrismaClient, gateway: GooglePullGateway, events: GoogleEvent[], now: Date, withinBudget: () => boolean,
): Promise<number> {
  // Only an event at the booking's own id is the website's: a copy made in Google carries the property too.
  const listed = new Map<string, GoogleEvent>();
  for (const event of events) {
    const appointmentId = websiteAppointmentId(event);
    if (appointmentId && event.id === googleEventIdFor(appointmentId)) listed.set(appointmentId, event);
  }
  if (listed.size === 0) return 0;
  const appointments = await db.appointment.findMany({ where: { id: { in: [...listed.keys()] } }, select: appointmentSelect });
  const from = windowStart(now);
  const open = appointments.filter((appointment) => OPEN_STATUSES.has(appointment.status) && appointment.date >= from);
  const context = open.length > 0 ? await loadRenderContext(db, open) : null;

  let reverted = 0;
  for (const appointment of appointments) {
    const event = listed.get(appointment.id)!;
    if (appointment.status === 'CANCELLED') {
      if (event.status === 'cancelled' || !withinBudget()) continue;
      try {
        await gateway.deleteEvent(event.id);
      } catch (error) {
        await recordFailure(db, appointment.id, event.id, error);
        continue;
      }
      reverted += 1;
      const removed = { removed: true, syncedHash: null, syncedAt: now, attempts: 0, lastError: null };
      await db.googleCalendarEvent.upsert({
        where: { appointmentId: appointment.id }, create: { appointmentId: appointment.id, eventId: event.id, ...removed }, update: removed,
      }).catch(() => undefined);
      continue;
    }
    if (!context || !open.includes(appointment)) continue;
    const expected = renderAppointment(appointment, context);
    if (sameRenderedEvent(event, expected.event) || !withinBudget()) continue;
    try {
      await writeEvent(gateway, expected.event);
    } catch (error) {
      await recordFailure(db, appointment.id, expected.event.id, error);
      continue;
    }
    reverted += 1;
    const synced = { eventId: expected.event.id, syncedHash: expected.hash, syncedAt: now, removed: false, attempts: 0, lastError: null };
    await db.googleCalendarEvent.upsert({
      where: { appointmentId: appointment.id }, create: { appointmentId: appointment.id, ...synced }, update: synced,
    }).catch(() => undefined);
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
    const events = await gateway.listEvents({
      timeMin: new Date(now.getTime() - LOOKBACK_MS),
      timeMax: new Date(now.getTime() + LOOKAHEAD_MS),
    });
    // Busy time first: it is what keeps the website from selling a taken chair,
    // and the write-backs after it are the slow part. Website events are never
    // blocks (googleBusyBlocks' echo guard).
    const stylists = await db.stylist.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    const blocks = distinct(googleBusyBlocks(events, stylists));
    result.changed = await storeBusyBlocks(db, blocks, now);
    result.blocks = blocks.length;
    result.reverted = await revertWebsiteEvents(db, gateway, events, now, withinBudget);
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
