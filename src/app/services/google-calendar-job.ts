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
// Admin → Integrations → "Sync now" runs 'daily' as well. Both pulls go
// through the single-flight lock: the push's own writes bring Google
// notifications whose pulls would otherwise race this one replacing the busy
// blocks. Each part is isolated (one failing never stops the next), nothing is
// thrown to the caller, and the outcome is stored in the job row
// `google-calendar`, which the daily ops alert lists while it is failing: a
// failed push or pull (the pull also records lastPullError on
// GoogleCalendarSyncState), a watch channel that could not be made, or
// bookings Google would not take. Given the caller's deadline, the pull is
// skipped (and said so, not failed) when too little time is left for it.

import type { PrismaClient } from '@prisma/client';
import { googleCalendarConfig } from '@/app/lib/google-calendar-config';
import { describeFault } from '@/app/lib/fault';
import { OPERATIONS_MESSAGES } from './operations-messages';
import type { GooglePushResult } from './google-calendar-push';
import type { GooglePullResult } from './google-calendar-pull';

export const GOOGLE_CALENDAR_JOB = 'google-calendar';

export type GoogleCalendarRun = 'calendar-sync' | 'daily';

type ChannelOutcome = 'created' | 'renewed' | 'current' | 'disabled';

/** Not started with less time than this left: a pull lists Google (10 s a page at worst) before writing anything. */
export const PULL_MIN_REMAINING_MS = 35_000;
export const PULL_SKIPPED_NO_TIME = 'skipped: no time left';

export type GoogleCalendarSteps = {
  ok: boolean;
  /** Daily run only. */
  channel?: ChannelOutcome | 'failed';
  push: GooglePushResult | 'failed';
  /**
   * 'deferred': a pull already running elsewhere was asked to run again instead.
   * PULL_SKIPPED_NO_TIME: too little of the caller's time was left; the next run pulls.
   */
  pull: GooglePullResult | 'deferred' | 'failed' | typeof PULL_SKIPPED_NO_TIME;
};

export type GoogleCalendarJobResult = { skipped: 'disabled' } | GoogleCalendarSteps | { ok: false; error: true };

type JobDb = Pick<PrismaClient, 'backgroundJobState'>;

function logStep(step: string) {
  return (error: unknown) => {
    // Names and codes only: a Google or driver message can quote the calendar id or the database host.
    console.error(`Google Calendar ${step} failed:`, describeFault(error));
  };
}

async function runSteps(run: GoogleCalendarRun, deadline: number | undefined): Promise<GoogleCalendarSteps> {
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
  if (deadline !== undefined && deadline - Date.now() < PULL_MIN_REMAINING_MS) {
    // Started now it could be cut off mid-way; the webhook or the next run pulls instead.
    pull = PULL_SKIPPED_NO_TIME;
  } else {
    try {
      await runPullSingleFlight(async () => { pulled.result = await pullGoogleCalendar(); });
      pull = pulled.result ?? 'deferred';
    } catch (error) {
      logStep('pull')(error);
      pull = 'failed';
    }
  }

  const steps = { ...(channel === undefined ? {} : { channel }), push, pull };
  return { ok: failureOf(steps) === null, ...steps };
}

function pullFailed(pull: GoogleCalendarSteps['pull']): boolean {
  return pull === 'failed' || (typeof pull === 'object' && pull.failed === true);
}

/** The job row's sentence: a step that could not complete, then the channel, then bookings Google would not take. */
function failureOf(steps: Omit<GoogleCalendarSteps, 'ok'>): string | null {
  if (steps.push === 'failed' || pullFailed(steps.pull)) return OPERATIONS_MESSAGES.GOOGLE_SYNC_FAILED;
  if (steps.channel === 'failed') return OPERATIONS_MESSAGES.GOOGLE_CHANNEL_FAILED;
  if (steps.push.failed > 0) return OPERATIONS_MESSAGES.GOOGLE_EVENTS_FAILED;
  return null;
}

/**
 * Runs the Google Calendar part of a cron (or Sync now). Never throws, and
 * with the sync off returns before importing the sync or touching the
 * database. `deadline` (epoch ms) is when the caller's function is cut off:
 * its start plus its maxDuration.
 */
export async function runGoogleCalendarJob(
  run: GoogleCalendarRun,
  options: { db?: JobDb; deadline?: number } = {},
): Promise<GoogleCalendarJobResult> {
  // Kill-switch above the first database read (CLAUDE.md, "Neon compute budget").
  if (!googleCalendarConfig()) return { skipped: 'disabled' };
  const name = GOOGLE_CALENDAR_JOB;
  let db: JobDb | undefined = options.db;
  try {
    db ??= (await import('@/app/lib/prisma')).default;
    await db.backgroundJobState.upsert({ where: { name }, create: { name, lastStartedAt: new Date() }, update: { lastStartedAt: new Date() } });
    const steps = await runSteps(run, options.deadline);
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
