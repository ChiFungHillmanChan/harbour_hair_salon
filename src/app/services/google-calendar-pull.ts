import 'server-only';

// Google → website (docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md §6):
// lists the salon calendar, writes back any website event edited, moved or
// deleted in Google (the website wins, D6), and stores the salon's own
// Google-only events as GOOGLE busy blocks and the salon diary (GoogleDiaryEntry,
// docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md §5–§7).
// Google is never called inside a database transaction, and a failure is
// recorded on the sync state and reported in the result (`failed: true`), never thrown.

import type { Prisma, PrismaClient } from '@prisma/client';
import { googleCalendarConfig } from '@/app/lib/google-calendar-config';
import { describeFault } from '@/app/lib/fault';
import { createGoogleCalendarGateway, GoogleCalendarError, type GoogleEvent } from './google-calendar-gateway';
import { googleEventIdFor, GOOGLE_APPOINTMENT_PROPERTY, sameRenderedEvent } from './google-calendar-event';
import { googleBusyBlocks, googleBusyHash, type GoogleBusyBlock } from './google-busy-mapping';
import {
  diaryEntriesFrom, diaryHash, GOOGLE_DIARY_LOOKAHEAD_DAYS, GOOGLE_DIARY_RETENTION_DAYS, type DiaryEntry, type DiaryKind,
} from './google-diary-classify';
import { loadDiaryConfig } from './google-diary-config';
import {
  appointmentSelect, loadRenderContext, recordFailure, renderAppointment, windowStart, writeEvent,
} from './google-calendar-push';
import { invalidateStylistIcalFeedFromCron } from './stylist-ical-cache';
import { OPERATIONS_MESSAGES } from './operations-messages';

const DAY_MS = 24 * 60 * 60_000;
/** Inbound window (diary mirror spec §7): Google is listed from 30 days back to 90 days ahead. */
const LOOKBACK_MS = GOOGLE_DIARY_RETENTION_DAYS * DAY_MS;
const LOOKAHEAD_MS = GOOGLE_DIARY_LOOKAHEAD_DAYS * DAY_MS;
/** GOOGLE busy blocks keep #72's one-day look-back: busy time that long gone changes nothing bookable. */
const BUSY_LOOKBACK_MS = DAY_MS;
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

/**
 * `changed`: the GOOGLE busy blocks changed (the busy feeds were dropped); `diaryChanged`: the diary entries changed.
 * `failed`: the pull could not complete (recorded as lastPullError); the caller decides what that means for its run.
 */
export type GooglePullResult = {
  reverted: number; blocks: number; entries: number; changed: boolean; diaryChanged: boolean; skipped?: 'disabled'; failed?: true;
};

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

/** Only blocks that have not ended can change what is bookable or what the busy feed exports. */
function notEnded(blocks: GoogleBusyBlock[], now: Date): GoogleBusyBlock[] {
  return blocks.filter((block) => block.end.getTime() > now.getTime());
}

const diarySelect = {
  googleEventId: true, kind: true, stylistIdsJson: true, title: true, colorId: true, start: true, end: true, allDay: true, htmlLink: true,
} satisfies Prisma.GoogleDiaryEntrySelect;
type StoredDiaryRow = Prisma.GoogleDiaryEntryGetPayload<{ select: typeof diarySelect }>;

function storedStylistIds(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function fromRow({ stylistIdsJson, kind, ...row }: StoredDiaryRow): DiaryEntry {
  return { ...row, kind: kind as DiaryKind, stylistIds: storedStylistIds(stylistIdsJson) };
}

/**
 * Stores the diary and the busy time it implies. Entries that ended before
 * the window are deleted first (privacy notice: 30 days). Then, when either
 * changed, ONE transaction replaces the window's GOOGLE busy blocks (as #72)
 * and/or the window's diary entries, so readers never see half a diary.
 * Compared at this pull's `now`: busy blocks that have not ended against the
 * stored ones that have not ended (as #72), the window's entries against the
 * stored window. The busy feeds are dropped only when busy blocks changed: a
 * renamed walk-in or a new note changes nothing Fresha imports.
 */
async function storeDiary(
  db: PrismaClient, entries: DiaryEntry[], blocks: GoogleBusyBlock[], range: { timeMin: Date; timeMax: Date }, now: Date,
): Promise<{ busyChanged: boolean; diaryChanged: boolean }> {
  await db.googleDiaryEntry.deleteMany({ where: { end: { lte: range.timeMin } } });
  const [storedBlocks, storedEntries] = await Promise.all([
    db.externalBusyBlock.findMany({
      where: { source: 'GOOGLE', end: { gt: now } },
      select: { externalUid: true, stylistId: true, start: true, end: true },
    }),
    db.googleDiaryEntry.findMany({ where: { end: { gt: range.timeMin }, start: { lt: range.timeMax } }, select: diarySelect }),
  ]);
  const hash = googleBusyHash(notEnded(blocks, now));
  const busyChanged = googleBusyHash(storedBlocks) !== hash;
  const diaryChanged = diaryHash(storedEntries.map(fromRow)) !== diaryHash(entries);
  if (!busyChanged && !diaryChanged) return { busyChanged, diaryChanged };
  await db.$transaction(async (tx) => {
    if (busyChanged) {
      await tx.externalBusyBlock.deleteMany({
        where: { source: 'GOOGLE', end: { gt: new Date(now.getTime() - BUSY_LOOKBACK_MS) }, start: { lt: range.timeMax } },
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
    }
    if (diaryChanged) {
      await tx.googleDiaryEntry.deleteMany({ where: { end: { gt: range.timeMin }, start: { lt: range.timeMax } } });
      for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
        const batch = entries.slice(offset, offset + BATCH_SIZE);
        // An entry stored outside the window and moved into it keeps its id: drop the old row first.
        await tx.googleDiaryEntry.deleteMany({ where: { googleEventId: { in: batch.map((entry) => entry.googleEventId) } } });
        await tx.googleDiaryEntry.createMany({
          data: batch.map((entry) => ({
            googleEventId: entry.googleEventId, kind: entry.kind, stylistIdsJson: JSON.stringify(entry.stylistIds),
            title: entry.title, colorId: entry.colorId, start: entry.start, end: entry.end,
            allDay: entry.allDay, htmlLink: entry.htmlLink, lastSyncAt: now,
          })),
        });
      }
    }
  }, { timeout: 15_000, maxWait: 5_000 });
  if (busyChanged) {
    // The stylists' outbound feeds export GOOGLE blocks. A route handler cannot
    // updateTag; the feed's one-day safety net heals a failed drop.
    try {
      invalidateStylistIcalFeedFromCron();
    } catch (error) {
      console.error('Dropping the busy-feed cache after a Google Calendar pull failed:', describeFault(error));
    }
  }
  return { busyChanged, diaryChanged };
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
    const row = appointment.googleCalendarEvent;
    // Missing or deleted in Google counts as changed (sameRenderedEvent compares the deleted state).
    if (event && sameRenderedEvent(event, expected.event)) {
      // Google holds the website's own rendering again: a "not kept" note from an earlier pull is
      // out of date. Conditional, so a push failure recorded meanwhile stays for the push to retry.
      if (row && row.syncedHash === expected.hash && row.lastError === OPERATIONS_MESSAGES.GOOGLE_EVENT_NOT_KEPT) {
        await db.googleCalendarEvent.updateMany({
          where: { appointmentId: appointment.id, syncedHash: expected.hash, lastError: OPERATIONS_MESSAGES.GOOGLE_EVENT_NOT_KEPT },
          data: { lastError: null },
        }).catch(logRowFailure(appointment.id));
      }
      continue;
    }
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
  if (!googleCalendarConfig()) return { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false, skipped: 'disabled' };
  const db = options.db ?? (await import('@/app/lib/prisma')).default;
  const now = options.now ?? new Date();
  const gateway = options.gateway ?? createGoogleCalendarGateway();
  const startedAt = Date.now();
  const withinBudget = () => Date.now() - startedAt < TIME_BUDGET_MS;
  const result: GooglePullResult = { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false };

  try {
    const range = { timeMin: new Date(now.getTime() - LOOKBACK_MS), timeMax: new Date(now.getTime() + LOOKAHEAD_MS) };
    const events = await gateway.listEvents(range);
    // Busy time and the diary first: they are what keep the website from selling a
    // taken chair, and the write-backs after them are the slow part. Website events
    // are never part of the diary (classifyDiaryEvent's echo guard).
    const entries = diaryEntriesFrom(events, await loadDiaryConfig(db));
    const busyFrom = now.getTime() - BUSY_LOOKBACK_MS;
    const blocks = distinct(googleBusyBlocks(entries.filter((entry) => entry.end.getTime() > busyFrom)));
    const stored = await storeDiary(db, entries, blocks, range, now);
    result.changed = stored.busyChanged;
    result.diaryChanged = stored.diaryChanged;
    result.blocks = blocks.length;
    result.entries = entries.length;
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
    result.failed = true;
  }
  return result;
}
