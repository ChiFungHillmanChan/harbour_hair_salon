import type { PrismaClient } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { syncCalendarFeeds } from '@/app/services/calendar-sync-service';
import { isScheduledCalendarSyncOpen } from '@/app/services/calendar-sync-schedule';
import { cancelLateArrivals } from '@/app/services/late-arrival-cancel';
import { runGoogleCalendarJob } from '@/app/services/google-calendar-job';
import { OPERATIONS_MESSAGES } from '@/app/services/operations-messages';
import { describeFault } from '@/app/lib/fault';

// The feed import stops starting new feeds after 40 seconds, and the Google
// Calendar push and pull after it keep to 40 seconds each (their own budgets);
// the time is mostly network wait.
export const maxDuration = 180;

export async function GET(request: NextRequest) {
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
  const name = 'calendar-sync';
  try {
    await db.backgroundJobState.upsert({ where: { name }, create: { name, lastStartedAt: new Date() }, update: { lastStartedAt: new Date() } });
    const results = await syncCalendarFeeds();
    const ok = results.every((entry) => entry.ok);
    await db.backgroundJobState.update({ where: { name }, data: {
      ...(ok ? { lastSucceededAt: new Date(), lastError: null } : { lastFailedAt: new Date(), lastError: 'Some calendar connections failed. Check Integrations; previous busy periods were retained.' }),
      lastResultJson: JSON.stringify({ connections: results.length, succeeded: results.filter((entry) => entry.ok && !entry.skipped).length, failed: results.filter((entry) => !entry.ok).length }),
    } });
    const lateArrivals = await runLateArrivals(db);
    // After the late-arrival step, so its cancellations reach Google in the same run.
    const googleCalendar = await runGoogleCalendar(db);
    return NextResponse.json({ ok, results, lateArrivals, googleCalendar }, { status: ok ? 200 : 502 });
  } catch {
    try {
      await db.backgroundJobState.update({ where: { name }, data: { lastFailedAt: new Date(), lastError: 'Calendar worker could not complete. Check database and connection configuration.' } });
    } catch { /* A database outage may also prevent saving its own diagnostic. */ }
    return NextResponse.json({ ok: false, error: 'Calendar sync could not complete.' }, { status: 503 });
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
 * safety net for a missed notification. Its own job row (`google-calendar`);
 * never fails the sync, and with the Google sync off it makes no query and no call.
 */
async function runGoogleCalendar(db: Pick<PrismaClient, 'backgroundJobState'>) {
  try {
    return await runGoogleCalendarJob('calendar-sync', { db });
  } catch (error) {
    // The job records its own failures; this is a failure to load it.
    console.error('Google Calendar step failed:', describeFault(error));
    return { error: true as const };
  }
}
