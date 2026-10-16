import 'server-only';

// The Google Calendar work that rides the existing crons
// (docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md §7:
// no new cron, so no new Neon wake):
//   - 'calendar-sync' (every 30 minutes in staff hours, the database already
//     awake): push the bookings changed recently, never synced or failing,
//     then pull as the safety net for a missed notification;
//   - 'daily' (housekeeping, 03:15 UTC): make sure the watch channel lives
//     (renewed within 48 hours of expiry), push the whole window (re-renders
//     every booking, deletes copies past the 12-month limit), then pull.
// Both pulls go through the single-flight lock: the push's own writes bring
// Google notifications whose pulls would otherwise race this one replacing
// the busy blocks. Each part is isolated (one failing never stops the next),
// nothing is thrown to the cron, and the outcome is stored in the job row
// `google-calendar`, which the daily ops alert lists while it is failing.
// The pull records its own outcome on GoogleCalendarSyncState as well.

import type { PrismaClient } from '@prisma/client';
import { googleCalendarConfig } from '@/app/lib/google-calendar-config';
import { describeFault } from '@/app/lib/fault';
import { OPERATIONS_MESSAGES } from './operations-messages';
import type { GooglePushResult } from './google-calendar-push';
import type { GooglePullResult } from './google-calendar-pull';

export const GOOGLE_CALENDAR_JOB = 'google-calendar';

export type GoogleCalendarRun = 'calendar-sync' | 'daily';

type ChannelOutcome = 'created' | 'renewed' | 'current' | 'disabled';

export type GoogleCalendarSteps = {
  ok: boolean;
  /** Daily run only. */
  channel?: ChannelOutcome | 'failed';
  push: GooglePushResult | 'failed';
  /** 'deferred': a pull already running elsewhere was asked to run again instead. */
  pull: GooglePullResult | 'deferred' | 'failed';
};

export type GoogleCalendarJobResult = { skipped: 'disabled' } | GoogleCalendarSteps | { ok: false; error: true };

type JobDb = Pick<PrismaClient, 'backgroundJobState'>;

function logStep(step: string) {
  return (error: unknown) => {
    // Names and codes only: a Google or driver message can quote the calendar id or the database host.
    console.error(`Google Calendar ${step} failed:`, describeFault(error));
  };
}

async function runSteps(run: GoogleCalendarRun): Promise<GoogleCalendarSteps> {
  const [{ ensureGoogleWatchChannel, runPullSingleFlight }, { pushGoogleCalendar }, { pullGoogleCalendar }] = await Promise.all([
    import('./google-calendar-channel'),
    import('./google-calendar-push'),
    import('./google-calendar-pull'),
  ]);

  let channel: GoogleCalendarSteps['channel'];
  if (run === 'daily') {
    try {
      channel = await ensureGoogleWatchChannel({ renew: false });
    } catch (error) {
      // It throws and records nothing: this job row is where its failure is kept.
      logStep('watch channel')(error);
      channel = 'failed';
    }
  }

  let push: GoogleCalendarSteps['push'];
  try {
    push = await pushGoogleCalendar({ mode: run === 'daily' ? 'all' : 'recent' });
  } catch (error) {
    logStep('push')(error);
    push = 'failed';
  }

  const pulled: { result?: GooglePullResult } = {};
  let pull: GoogleCalendarSteps['pull'];
  try {
    await runPullSingleFlight(async () => { pulled.result = await pullGoogleCalendar(); });
    pull = pulled.result ?? 'deferred';
  } catch (error) {
    logStep('pull')(error);
    pull = 'failed';
  }

  const ok = channel !== 'failed' && push !== 'failed' && push.failed === 0 && pull !== 'failed';
  return { ok, ...(channel === undefined ? {} : { channel }), push, pull };
}

/** The job row's sentence: a step that could not complete, then the channel, then bookings Google would not take. */
function failureOf(steps: GoogleCalendarSteps): string | null {
  if (steps.push === 'failed' || steps.pull === 'failed') return OPERATIONS_MESSAGES.GOOGLE_SYNC_FAILED;
  if (steps.channel === 'failed') return OPERATIONS_MESSAGES.GOOGLE_CHANNEL_FAILED;
  if (steps.push.failed > 0) return OPERATIONS_MESSAGES.GOOGLE_EVENTS_FAILED;
  return null;
}

/**
 * Runs the Google Calendar part of a cron. Never throws, and with the sync
 * off returns before importing the sync or touching the database.
 */
export async function runGoogleCalendarJob(run: GoogleCalendarRun, options: { db?: JobDb } = {}): Promise<GoogleCalendarJobResult> {
  // Kill-switch above the first database read (CLAUDE.md, "Neon compute budget").
  if (!googleCalendarConfig()) return { skipped: 'disabled' };
  const name = GOOGLE_CALENDAR_JOB;
  let db: JobDb | undefined = options.db;
  try {
    db ??= (await import('@/app/lib/prisma')).default;
    await db.backgroundJobState.upsert({ where: { name }, create: { name, lastStartedAt: new Date() }, update: { lastStartedAt: new Date() } });
    const steps = await runSteps(run);
    const lastError = failureOf(steps);
    await db.backgroundJobState.update({ where: { name }, data: {
      ...(lastError ? { lastFailedAt: new Date(), lastError } : { lastSucceededAt: new Date(), lastError: null }),
      lastResultJson: JSON.stringify(steps),
    } });
    return steps;
  } catch (error) {
    logStep('job')(error);
    try {
      await db?.backgroundJobState.update({ where: { name }, data: { lastFailedAt: new Date(), lastError: OPERATIONS_MESSAGES.GOOGLE_SYNC_FAILED } });
    } catch { /* A database outage may also prevent saving its own diagnostic. */ }
    return { ok: false, error: true };
  }
}
