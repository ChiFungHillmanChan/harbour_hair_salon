import type { PrismaClient } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';
import { syncCalendarFeeds } from '@/app/services/calendar-sync-service';
import { isScheduledCalendarSyncOpen } from '@/app/services/calendar-sync-schedule';
import { cancelLateArrivals } from '@/app/services/late-arrival-cancel';
import { runGoogleCalendarJob, type GoogleCalendarJobDb } from '@/app/services/google-calendar-job';
import { OPERATIONS_MESSAGES } from '@/app/services/operations-messages';
import { describeFault } from '@/app/lib/fault';
import { BOOKING_OPEN_TAG } from '@/app/lib/booking-constants';

// Mostly network wait. The feed import starts no new feed after 40 seconds;
// the Google push starts no new write after 40 seconds (each Google call may
// take 10 more); the Google pull is not started with less than 35 seconds of
// this limit left (google-calendar-job.ts) and starts no write-back after 40.
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  // When this function is cut off: the Google step skips its pull rather than start it too late.
  const deadline = Date.now() + maxDuration * 1000;
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Above the lazy service's very first DB call: a disabled cron cannot wake Neon.
  if (process.env.CALENDAR_SYNC_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'disabled', results: [] });
  }
  // Cache-backed hours check BEFORE job-state writes or feed reads.
  try {
    if (!await isScheduledCalendarSyncOpen()) {
      return NextResponse.json({ ok: true, skipped: 'outside-opening-hours', results: [] });
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Calendar opening hours could not be checked.' }, { status: 503 });
  }
  const db = (await import('@/app/lib/prisma')).default;
  // A feed step that throws (its job row, the candidate list or a lease, e.g.
  // on a dropped connection) still answers 503, but no longer skips the steps
  // below: neither depends on the feed import (review 2026-10-25, as
  // housekeeping does since 2026-10-24).
  const feeds = await runFeedImport(db);
  const lateArrivals = await runLateArrivals(db);
  // After the late-arrival step, so its cancellations reach Google in the same run.
  const googleCalendar = await runGoogleCalendar(db, deadline);
  await followUpBookingGate(db);
  if (!feeds) return NextResponse.json({ ok: false, error: 'Calendar sync could not complete.', lateArrivals, googleCalendar }, { status: 503 });
  return NextResponse.json({ ok: feeds.ok, results: feeds.results, lateArrivals, googleCalendar }, { status: feeds.ok ? 200 : 502 });
}

/**
 * Feeds may have just changed whether booking is open: drop the cached answer
 * so the next visitor is told the truth, and tell the salon once a day if
 * booking is switched on but refusing customers. On this run's existing wake.
 * Never fails the cron.
 */
async function followUpBookingGate(db: PrismaClient) {
  try {
    if (process.env.NOTIFICATIONS_ENABLED !== 'true') return;
    revalidateTag(BOOKING_OPEN_TAG, { expire: 0 });
    const [{ sendBookingClosedAlert }, { sendSalonNotice }] = await Promise.all([
      import('@/app/services/booking-closed-alert'),
      import('@/app/services/email-service'),
    ]);
    await sendBookingClosedAlert({ db, now: new Date(), env: process.env, send: sendSalonNotice });
  } catch (error) {
    console.error('Booking-closed follow-up failed:', describeFault(error));
  }
}

/** The Fresha / Treatwell feed import and its `calendar-sync` job row; null when it could not run. */
async function runFeedImport(db: Pick<PrismaClient, 'backgroundJobState'>) {
  const name = 'calendar-sync';
  try {
    await db.backgroundJobState.upsert({ where: { name }, create: { name, lastStartedAt: new Date() }, update: { lastStartedAt: new Date() } });
    const results = await syncCalendarFeeds();
    const ok = results.every((entry) => entry.ok);
    await db.backgroundJobState.update({ where: { name }, data: {
      ...(ok ? { lastSucceededAt: new Date(), lastError: null } : { lastFailedAt: new Date(), lastError: 'Some calendar connections failed. Check Integrations; previous busy periods were retained.' }),
      lastResultJson: JSON.stringify({ connections: results.length, succeeded: results.filter((entry) => entry.ok && !entry.skipped).length, failed: results.filter((entry) => !entry.ok).length }),
    } });
    return { ok, results };
  } catch (error) {
    console.error('Calendar feed import failed:', describeFault(error));
    try {
      await db.backgroundJobState.update({ where: { name }, data: { lastFailedAt: new Date(), lastError: 'Calendar worker could not complete. Check database and connection configuration.' } });
    } catch { /* A database outage may also prevent saving its own diagnostic. */ }
    return null;
  }
}

/** Rides this cron (no extra Neon wake): its own job row, never fails the sync. */
async function runLateArrivals(db: Pick<PrismaClient, 'backgroundJobState'>) {
  const name = 'late-arrival-cancel';
  try {
    await db.backgroundJobState.upsert({ where: { name }, create: { name, lastStartedAt: new Date() }, update: { lastStartedAt: new Date() } });
    const result = await cancelLateArrivals(new Date());
    await db.backgroundJobState.update({ where: { name }, data: result.failed
      ? { lastFailedAt: new Date(), lastError: OPERATIONS_MESSAGES.LATE_ARRIVAL_FAILED, lastResultJson: JSON.stringify(result) }
      : { lastSucceededAt: new Date(), lastError: null, lastResultJson: JSON.stringify(result) } });
    return result;
  } catch (error) {
    console.error('Late-arrival step failed:', error instanceof Error ? error.name : 'unknown');
    try {
      await db.backgroundJobState.update({ where: { name }, data: { lastFailedAt: new Date(), lastError: OPERATIONS_MESSAGES.LATE_ARRIVAL_FAILED } });
    } catch { /* A database outage may also prevent saving its own diagnostic. */ }
    return { error: true as const };
  }
}

/**
 * Rides this cron too (no extra Neon wake): writes the recently changed,
 * never-synced and failing bookings to the salon's Google Calendar (the
 * late-arrival cancellations just made included), then pulls Google as the
 * safety net for a missed notification, and checks the sync's health (a live
 * watch channel, a successful check of Google within 24 hours). Its own job
 * row (`google-calendar`); never fails the sync, and with the Google sync off
 * it makes no query and no call.
 */
async function runGoogleCalendar(db: GoogleCalendarJobDb, deadline: number) {
  try {
    return await runGoogleCalendarJob('calendar-sync', { db, deadline });
  } catch (error) {
    // The job records its own failures; this is a failure to load it.
    console.error('Google Calendar step failed:', describeFault(error));
    return { error: true as const };
  }
}
