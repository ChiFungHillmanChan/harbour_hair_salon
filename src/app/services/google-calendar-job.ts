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
// Admin → Integrations → "Sync now" runs 'daily' as well, with `renew`: it
// replaces the watch channel at once, so a rotated GOOGLE_CALENDAR_WEBHOOK_SECRET
// takes effect without waiting for the old channel to run out (housekeeping
// never asks, or it would replace the channel every night). Both pulls go
// through the single-flight lock: the push's own writes bring Google
// notifications whose pulls would otherwise race this one replacing the busy
// blocks. Each part is isolated (one failing never stops the next), nothing is
// thrown to the caller, and the outcome is stored in a job row the daily ops
// alert lists while it is failing: `google-calendar` for the 30-minute run,
// `google-calendar-daily` for housekeeping and Sync now (their own row, so a
// 03:15 channel failure is not wiped by the next 30-minute success). A row
// fails for a push or pull that could not complete (the pull also records
// lastPullError on GoogleCalendarSyncState), a watch channel that could not be
// made, or bookings Google would not take. The 30-minute run also checks the
// sync's health (spec §8; the database is already awake): no live watch
// channel, or no successful check of Google for 24 hours. Given the caller's
// deadline, the pull is skipped (and said so, not failed) when too little time
// is left for it.

import type { PrismaClient } from '@prisma/client';
import { googleCalendarConfig } from '@/app/lib/google-calendar-config';
import { describeFault } from '@/app/lib/fault';
import { OPERATIONS_MESSAGES } from './operations-messages';
import type { GooglePushResult } from './google-calendar-push';
import type { GooglePullResult } from './google-calendar-pull';

/** The 30-minute run's job row (calendar-sync cron). */
export const GOOGLE_CALENDAR_JOB = 'google-calendar';
/** The daily run's own job row (housekeeping, Sync now): its channel failure outlives the next 30-minute success. */
export const GOOGLE_CALENDAR_DAILY_JOB = 'google-calendar-daily';
/** No successful check of Google for this long is a problem in itself (spec §8). */
export const PULL_STALE_MS = 24 * 60 * 60_000;

export type GoogleCalendarRun = 'calendar-sync' | 'daily';

/**
 * What the 30-minute run finds in GoogleCalendarSyncState. `pull: 'none-yet'`:
 * no check of Google has been attempted yet (a fresh setup), which is not a
 * problem; once one has been attempted, never succeeding counts as stale.
 */
export type GoogleCalendarHealth = { channel: 'ok' | 'missing' | 'expired'; pull: 'ok' | 'stale' | 'none-yet' };

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
  /** The 30-minute run only, read after its own pull. */
  health?: GoogleCalendarHealth;
};

export type GoogleCalendarJobResult = { skipped: 'disabled' } | GoogleCalendarSteps | { ok: false; error: true };

type JobDb = Pick<PrismaClient, 'backgroundJobState' | 'googleCalendarSyncState'>;

function logStep(step: string) {
  return (error: unknown) => {
    // Names and codes only: a Google or driver message can quote the calendar id or the database host.
    console.error(`Google Calendar ${step} failed:`, describeFault(error));
  };
}

/** Read after the run's own pull, so a pull that just succeeded counts. */
async function checkHealth(db: JobDb, now: Date): Promise<GoogleCalendarHealth> {
  const state = await db.googleCalendarSyncState.findUnique({
    where: { id: 'singleton' },
    select: { channelId: true, channelExpiresAt: true, lastPullAt: true, lastPullSuccessAt: true },
  });
  const channel = !state?.channelId || !state.channelExpiresAt
    ? 'missing'
    : state.channelExpiresAt.getTime() <= now.getTime() ? 'expired' : 'ok';
  const pull = state?.lastPullSuccessAt
    ? (now.getTime() - state.lastPullSuccessAt.getTime() > PULL_STALE_MS ? 'stale' : 'ok')
    : state?.lastPullAt ? 'stale' : 'none-yet';
  return { channel, pull };
}

async function runSteps(db: JobDb, run: GoogleCalendarRun, deadline: number | undefined, renew: boolean): Promise<GoogleCalendarSteps> {
  const [{ ensureGoogleWatchChannel, runPullSingleFlight }, { pushGoogleCalendar }, { pullGoogleCalendar }] = await Promise.all([
    import('./google-calendar-channel'),
    import('./google-calendar-push'),
    import('./google-calendar-pull'),
  ]);

  let channel: GoogleCalendarSteps['channel'];
  if (run === 'daily') {
    try {
      channel = await ensureGoogleWatchChannel({ renew });
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

  const health = run === 'calendar-sync' ? await checkHealth(db, new Date()) : undefined;
  const steps = { ...(channel === undefined ? {} : { channel }), push, pull, ...(health ? { health } : {}) };
  return { ok: failureOf(steps) === null, ...steps };
}

function pullFailed(pull: GoogleCalendarSteps['pull']): boolean {
  return pull === 'failed' || (typeof pull === 'object' && pull.failed === true);
}

/**
 * The job row's sentence, most urgent first: a step that could not complete,
 * no successful check of Google for 24 hours, the watch channel (not made, or
 * none live), then bookings Google would not take.
 */
function failureOf(steps: Omit<GoogleCalendarSteps, 'ok'>): string | null {
  // A push stopped by a setup failure is said once here, not once per booking.
  if (steps.push === 'failed' || steps.push.stopped === 'setup' || pullFailed(steps.pull)) return OPERATIONS_MESSAGES.GOOGLE_SYNC_FAILED;
  if (steps.health?.pull === 'stale') return OPERATIONS_MESSAGES.GOOGLE_PULL_STALE;
  if (steps.channel === 'failed') return OPERATIONS_MESSAGES.GOOGLE_CHANNEL_FAILED;
  if (steps.health && steps.health.channel !== 'ok') return OPERATIONS_MESSAGES.GOOGLE_CHANNEL_MISSING;
  if (steps.push.failed > 0) return OPERATIONS_MESSAGES.GOOGLE_EVENTS_FAILED;
  return null;
}

/**
 * Runs the Google Calendar part of a cron (or Sync now). Never throws, and
 * with the sync off returns before importing the sync or touching the
 * database. `deadline` (epoch ms) is when the caller's function is cut off:
 * its start plus its maxDuration. `renew` (daily run only; Sync now passes
 * true, housekeeping false) replaces the watch channel even when it is not
 * near its expiry.
 */
export async function runGoogleCalendarJob(
  run: GoogleCalendarRun,
  options: { db?: JobDb; deadline?: number; renew?: boolean } = {},
): Promise<GoogleCalendarJobResult> {
  // Kill-switch above the first database read (CLAUDE.md, "Neon compute budget").
  if (!googleCalendarConfig()) return { skipped: 'disabled' };
  const name = run === 'daily' ? GOOGLE_CALENDAR_DAILY_JOB : GOOGLE_CALENDAR_JOB;
  let db: JobDb | undefined = options.db;
  try {
    db ??= (await import('@/app/lib/prisma')).default;
    await db.backgroundJobState.upsert({ where: { name }, create: { name, lastStartedAt: new Date() }, update: { lastStartedAt: new Date() } });
    const steps = await runSteps(db, run, options.deadline, options.renew === true);
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
