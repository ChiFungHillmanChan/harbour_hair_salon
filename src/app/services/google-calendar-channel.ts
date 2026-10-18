import 'server-only';

// Google → website notifications (docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md §6–§7):
// the watch channel through which Google calls /api/webhooks/google-calendar,
// and the single-flight pull those calls run. Neither ever pushes to Google:
// a push from the notification path would bring another notification, and so
// another pull, without end.

import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
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
/** The token outlives the expiry asked for by an hour, for clock skew; Google never grants more than asked. */
const TOKEN_MARGIN_MS = 60 * 60_000;
export const GOOGLE_WEBHOOK_PATH = '/api/webhooks/google-calendar';

/** Only what the channel needs; the full gateway satisfies it. */
export type GoogleChannelGateway = Pick<ReturnType<typeof createGoogleCalendarGateway>, 'watch' | 'stopChannel'>;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Records `channel` only if the row still holds the channel read before it
 * was created (`expected`): of two callers racing, one wins. False = lost.
 */
async function recordChannel(
  db: PrismaClient,
  expected: { rowExists: boolean; channelId: string | null },
  channel: { channelId: string; resourceId: string; channelExpiresAt: Date },
): Promise<boolean> {
  const replace = () => db.googleCalendarSyncState.updateMany({ where: { id: STATE_ID, channelId: expected.channelId }, data: channel });
  if ((await replace()).count === 1) return true;
  if (expected.rowExists) return false;
  try {
    await db.googleCalendarSyncState.create({ data: { id: STATE_ID, ...channel } });
    return true;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  // Created meanwhile: by the pull (no channel yet), or by a rival's channel.
  return expected.channelId === null && (await replace()).count === 1;
}

/**
 * Makes sure Google has a live channel notifying the webhook: creates one
 * when there is none, when it has expired or expires within 48 hours, or when
 * `renew` asks. The new channel is created and recorded before the old one is
 * stopped (a failed stop is ignored: the old channel simply runs out). The
 * record is conditional on the channel read first: a caller that loses a race
 * stops the channel it just created and answers 'current'. A failure to
 * create one is thrown for the caller to record.
 */
export async function ensureGoogleWatchChannel(options: {
  db?: PrismaClient;
  now?: Date;
  gateway?: GoogleChannelGateway;
  renew?: boolean;
} = {}): Promise<'created' | 'renewed' | 'current' | 'disabled'> {
  // Kill-switch above the first database read (docs/agents/neon-budget.md).
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
  const expiration = new Date(now.getTime() + CHANNEL_LIFETIME_MS);
  const created = await gateway.watch({
    id,
    token: channelToken(config.webhookSecret, id, new Date(expiration.getTime() + TOKEN_MARGIN_MS)),
    address: `${SITE_URL}${GOOGLE_WEBHOOK_PATH}`,
    expiration,
  });
  // Unrecorded, a channel could never be stopped or renewed: stop it at once.
  const stopCreated = () => gateway.stopChannel({ id, resourceId: created.resourceId }).catch((error: unknown) => {
    console.error('Stopping an unrecorded Google Calendar channel failed:', describeFault(error));
  });
  let recorded: boolean;
  try {
    recorded = await recordChannel(
      db,
      { rowExists: state !== null, channelId: state?.channelId ?? null },
      { channelId: id, resourceId: created.resourceId, channelExpiresAt: created.expiration },
    );
  } catch (error) {
    await stopCreated();
    throw error;
  }
  if (!recorded) {
    // Another caller recorded its channel (and stops the old one) first.
    await stopCreated();
    return 'current';
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
/** The webhook route's maxDuration: a lock never runs out under a pull that is still going. */
const LOCK_SECONDS = 90;
const AGAIN_SECONDS = 120;
/**
 * The first pull, a re-run for changes made during it (the website's own
 * write-backs among them), and one more for an edit made during that re-run.
 * No pass starts once PASS_START_BUDGET_MS have gone, so the run ends inside
 * the webhook's 90 seconds. A request left after the last pass is picked up
 * by the next notification or the calendar-sync safety net.
 */
const MAX_PASSES = 3;
const PASS_START_BUDGET_MS = 60_000;
/** A Redis that hangs is treated as one that fails: the pull goes ahead. */
const REDIS_TIMEOUT_MS = 2_000;
/** Deletes the lock only while it still holds this owner's value. */
const RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** The Upstash commands the lock uses. */
export type PullLockStore = {
  set(key: string, value: string, options: { nx: true; ex: number } | { ex: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  get(key: string): Promise<unknown>;
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
  const release = (step: string) => redis.eval(RELEASE_SCRIPT, [LOCK_KEY], [owner]).then(() => undefined, logRedisFault(step));
  const acquire = async () => {
    if ((await redis.set(LOCK_KEY, owner, { nx: true, ex: LOCK_SECONDS })) === 'OK') return true;
    // The client retries a SET whose reply was lost: one that finds its own first try holds the lock.
    return (await redis.get(LOCK_KEY)) === owner;
  };
  /** Redis failed: pull anyway, then free a lock that may have been taken although its reply was lost. */
  const pullWithoutLock = async (step: string, error: unknown) => {
    logRedisFault(step)(error);
    try {
      await pull();
    } finally {
      await release('releasing a lock that may have been taken');
    }
  };

  try {
    if (!(await acquire())) {
      await redis.set(AGAIN_KEY, '1', { ex: AGAIN_SECONDS });
      // The holder may have finished (and looked for a request) in between:
      // then the lock is free and this caller pulls itself.
      if (!(await acquire())) return;
    }
  } catch (error) {
    await pullWithoutLock('taking the lock or asking for a re-run', error);
    return;
  }

  const startedAt = Date.now();
  for (let pass = 1; ; pass += 1) {
    // A request made before this pass starts is covered by it.
    await redis.del(AGAIN_KEY).catch(logRedisFault('clearing the re-run request'));
    try {
      await pull();
    } finally {
      await release('releasing the lock');
    }
    if (pass >= MAX_PASSES || Date.now() - startedAt >= PASS_START_BUDGET_MS) return;
    let requested: unknown;
    try {
      // Read, not consumed: if another caller holds the lock by now, the
      // request stays for that holder's own check after its pull.
      requested = await redis.get(AGAIN_KEY);
    } catch (error) {
      logRedisFault('reading the re-run request')(error);
      return;
    }
    if (requested === null || requested === undefined) return;
    try {
      // Taken: the next pass starts by clearing the request it covers.
      // Not taken: the current holder pulls after taking the lock, or sees
      // the request when it finishes.
      if (!(await acquire())) return;
    } catch (error) {
      await pullWithoutLock('taking the lock again', error);
      return;
    }
  }
}
