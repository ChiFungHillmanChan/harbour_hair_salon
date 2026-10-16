import 'server-only';

// Google → website notifications (docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md §6–§7):
// the watch channel through which Google calls /api/webhooks/google-calendar,
// and the single-flight pull those calls run. Neither ever pushes to Google:
// a push from the notification path would bring another notification, and so
// another pull, without end.

import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Redis } from '@upstash/redis';
import { googleCalendarConfig } from '@/app/lib/google-calendar-config';
import { channelToken } from '@/app/lib/google-channel-token';
import { resolveRedisCredentials } from '@/app/lib/redis-credentials';
import { SITE_URL } from '@/app/lib/site-url';
import { describeFault } from '@/app/lib/fault';
import { createGoogleCalendarGateway } from './google-calendar-gateway';

const STATE_ID = 'singleton';
const DAY_MS = 24 * 60 * 60_000;
/** Asked for; Google may grant less, and what it grants is stored. */
const CHANNEL_LIFETIME_MS = 7 * DAY_MS;
/** Housekeeping runs daily: renewing within 48 hours of expiry gives it two chances. */
const RENEW_WITHIN_MS = 2 * DAY_MS;
export const GOOGLE_WEBHOOK_PATH = '/api/webhooks/google-calendar';

/** Only what the channel needs; the full gateway satisfies it. */
export type GoogleChannelGateway = Pick<ReturnType<typeof createGoogleCalendarGateway>, 'watch' | 'stopChannel'>;

/**
 * Makes sure Google has a live channel notifying the webhook: creates one
 * when there is none, when it has expired or expires within 48 hours, or when
 * `renew` asks. The new channel is created and recorded before the old one is
 * stopped (a failed stop is ignored: the old channel simply runs out). A
 * failure to create one is thrown for the caller to record.
 */
export async function ensureGoogleWatchChannel(options: {
  db?: PrismaClient;
  now?: Date;
  gateway?: GoogleChannelGateway;
  renew?: boolean;
} = {}): Promise<'created' | 'renewed' | 'current' | 'disabled'> {
  // Kill-switch above the first database read (CLAUDE.md, "Neon compute budget").
  const config = googleCalendarConfig();
  if (!config) return 'disabled';
  const db = options.db ?? (await import('@/app/lib/prisma')).default;
  const now = options.now ?? new Date();
  const gateway = options.gateway ?? createGoogleCalendarGateway();

  const state = await db.googleCalendarSyncState.findUnique({
    where: { id: STATE_ID },
    select: { channelId: true, resourceId: true, channelExpiresAt: true },
  });
  const previous = state?.channelId && state.resourceId
    ? { id: state.channelId, resourceId: state.resourceId, expiresAt: state.channelExpiresAt }
    : null;
  if (previous?.expiresAt && !options.renew && previous.expiresAt.getTime() - now.getTime() > RENEW_WITHIN_MS) return 'current';

  // A UUID fits Google's channel id rules ([A-Za-z0-9-_+/=], at most 64 characters).
  const id = randomUUID();
  const created = await gateway.watch({
    id,
    token: channelToken(config.webhookSecret, id),
    address: `${SITE_URL}${GOOGLE_WEBHOOK_PATH}`,
    expiration: new Date(now.getTime() + CHANNEL_LIFETIME_MS),
  });
  const channel = { channelId: id, resourceId: created.resourceId, channelExpiresAt: created.expiration };
  try {
    await db.googleCalendarSyncState.upsert({ where: { id: STATE_ID }, create: { id: STATE_ID, ...channel }, update: channel });
  } catch (error) {
    // Unrecorded, it could never be stopped or renewed: stop it now and let the caller retry.
    await gateway.stopChannel({ id, resourceId: created.resourceId }).catch((stopError: unknown) => {
      console.error('Stopping an unrecorded Google Calendar channel failed:', describeFault(stopError));
    });
    throw error;
  }
  if (!previous) return 'created';
  try {
    await gateway.stopChannel({ id: previous.id, resourceId: previous.resourceId });
  } catch (error) {
    console.error('Stopping the previous Google Calendar channel failed:', describeFault(error));
  }
  return 'renewed';
}

// ── single-flight pull ──────────────────────────────────────────────────────
// Each write to the calendar (the website's own included) brings a
// notification, so pulls arrive in bursts. One pull runs at a time; a
// notification that arrives during it asks for one more pass instead, which
// covers every change made while the pull was running.

const LOCK_KEY = 'google-calendar-pull';
const AGAIN_KEY = 'google-calendar-pull-again';
const LOCK_SECONDS = 60;
const AGAIN_SECONDS = 120;
/**
 * The first pull, a re-run for changes made during it (the website's own
 * write-backs among them), and one more for an edit made during that re-run.
 * A request left after the last is picked up by the next notification or the
 * calendar-sync safety net.
 */
const MAX_PASSES = 3;
/** A Redis that hangs is treated as one that fails: the pull goes ahead. */
const REDIS_TIMEOUT_MS = 2_000;
/** Deletes the lock only while it still holds this owner's value. */
const RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** The Upstash commands the lock uses. */
export type PullLockStore = {
  set(key: string, value: string, options: { nx: true; ex: number } | { ex: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  getdel(key: string): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
};

function defaultLockStore(): PullLockStore | null {
  // Read per call, never at module load (project convention).
  const credentials = resolveRedisCredentials(process.env);
  if (!credentials) return null;
  return new Redis({ ...credentials, retry: { retries: 1 }, signal: () => AbortSignal.timeout(REDIS_TIMEOUT_MS) });
}

function logRedisFault(step: string) {
  return (error: unknown) => {
    console.error(`Google Calendar pull lock: ${step} failed`, describeFault(error));
  };
}

/**
 * Runs `pull` unless another instance is pulling, in which case that one is
 * asked to pull once more after it finishes. Without Redis credentials, or
 * when Redis fails, it simply pulls: Redis decides how often, never whether.
 */
export async function runPullSingleFlight(
  pull: () => Promise<unknown>,
  options: { redis?: PullLockStore | null } = {},
): Promise<void> {
  const redis = options.redis === undefined ? defaultLockStore() : options.redis;
  if (!redis) {
    await pull();
    return;
  }
  const owner = randomUUID();
  const acquire = async () => (await redis.set(LOCK_KEY, owner, { nx: true, ex: LOCK_SECONDS })) === 'OK';

  try {
    if (!(await acquire())) {
      await redis.set(AGAIN_KEY, '1', { ex: AGAIN_SECONDS });
      // The holder may have finished (and looked for a request) in between:
      // then the lock is free and this caller pulls itself.
      if (!(await acquire())) return;
    }
  } catch (error) {
    logRedisFault('taking the lock or asking for a re-run')(error);
    await pull();
    return;
  }

  for (let pass = 1; ; pass += 1) {
    // A request made before this pass starts is covered by it.
    await redis.del(AGAIN_KEY).catch(logRedisFault('clearing the re-run request'));
    try {
      await pull();
    } finally {
      await redis.eval(RELEASE_SCRIPT, [LOCK_KEY], [owner]).catch(logRedisFault('releasing the lock'));
    }
    if (pass >= MAX_PASSES) return;
    let requested: unknown;
    try {
      requested = await redis.getdel(AGAIN_KEY);
    } catch (error) {
      logRedisFault('reading the re-run request')(error);
      return;
    }
    if (requested === null || requested === undefined) return;
    try {
      // Taken by another caller since the release: its pull covers the change.
      if (!(await acquire())) return;
    } catch (error) {
      logRedisFault('taking the lock again')(error);
      await pull();
      return;
    }
  }
}
