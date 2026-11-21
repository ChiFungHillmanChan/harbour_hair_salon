import 'server-only';
import { createHash } from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { SlidingWindow } from '@/app/lib/sliding-window';
import { withinTimeout } from '@/app/lib/within-timeout';
import { resolveRedisCredentials, REDIS_URL_KEYS, REDIS_TOKEN_KEYS } from '@/app/lib/redis-credentials';

/**
 * One rate-limiting policy.
 *
 * Every limiter in the app goes through here so that a missing UPSTASH_* env
 * can never silently disable limiting. Previously each call site did:
 *
 *     const limiter = getXLimiter();
 *     if (limiter) { ...check... }      // limiter === null → NO limit at all
 *
 * With Upstash unset in production that left booking creation, discount-code
 * validation and newsletter signup completely unlimited. Now an unset env
 * degrades to the in-process SlidingWindow instead of turning limiting off.
 */
export type RateLimitPolicy = {
  /** Redis key prefix, e.g. 'rl:booking'. Also used in fallback log lines. */
  prefix: string;
  /** Allowed hits per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

export type RateLimiter = {
  /** True when the attempt is allowed, false when the caller should back off. */
  check(key: string): Promise<boolean>;
  /** Which backend served the most recent check — for diagnostics/tests. */
  backend(): 'redis' | 'memory';
};

let redisClient: Redis | null | undefined;
let warnedAboutFallback = false;

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  // Env is read on first use, never at module load (project convention).
  // Accepts both the UPSTASH_* and Vercel-Marketplace KV_* naming schemes —
  // see lib/redis-credentials.ts.
  const credentials = resolveRedisCredentials(process.env);
  redisClient = credentials ? new Redis(credentials) : null;

  if (!redisClient && !warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      '[rate-limit] No Redis credentials found (looked for ' +
        `${REDIS_URL_KEYS.join('/')} and ${REDIS_TOKEN_KEYS.join('/')}) — falling back ` +
        'to per-instance in-memory limiting. This resets on cold start and is not ' +
        'shared across serverless instances. Configure Upstash for real limits.',
    );
  }
  return redisClient;
}

/**
 * Build a limiter for one policy. Cheap to call at module scope in a server
 * action file: the Redis client and window are created lazily on first check.
 */
/**
 * Upstash's `limit()` never rejects when Redis is slow: after `timeout` it
 * RESOLVES `{ success: true, reason: 'timeout' }`. Trusting that verdict made
 * every limiter (including the only brute-force control on admin sign-in) fail
 * open whenever Redis hung. Keep the wait short and treat a timeout exactly like
 * an outage: answer from the in-memory window instead.
 */
export const REDIS_TIMEOUT_MS = 1_500;

type RedisLimiter = { limit(key: string): Promise<{ success: boolean; reason?: string }> };

export function createRateLimiter(
  policy: RateLimitPolicy,
  /** Test seam: supply the Redis-backed limiter (or null) instead of building one from env. */
  deps: { redisLimiter?: RedisLimiter | null } = {},
): RateLimiter {
  const fallback = new SlidingWindow({
    limit: policy.limit,
    windowMs: policy.windowSeconds * 1000,
  });

  let redisLimiter: RedisLimiter | null | undefined = deps.redisLimiter;
  let lastBackend: 'redis' | 'memory' = 'memory';

  function getRedisLimiter(): RedisLimiter | null {
    if (redisLimiter !== undefined) return redisLimiter;
    const redis = getRedis();
    redisLimiter = redis
      ? new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(policy.limit, `${policy.windowSeconds} s`),
          prefix: policy.prefix,
          timeout: REDIS_TIMEOUT_MS,
        })
      : null;
    return redisLimiter;
  }

  return {
    backend: () => lastBackend,
    async check(key: string): Promise<boolean> {
      const limiter = getRedisLimiter();
      if (limiter) {
        try {
          const { success, reason } = await limiter.limit(key);
          if (reason !== 'timeout') {
            lastBackend = 'redis';
            return success;
          }
          console.error(`[rate-limit] ${policy.prefix} Redis timed out after ${REDIS_TIMEOUT_MS} ms, using in-memory fallback`);
        } catch (err) {
          // Redis outage: fall through to the in-memory window rather than
          // failing fully open, so an outage cannot be used as a bypass.
          console.error(`[rate-limit] ${policy.prefix} Redis unavailable, using in-memory fallback:`, err);
        }
      }
      lastBackend = 'memory';
      return fallback.check(key);
    },
  };
}

/**
 * A limiter that counts FAILURES rather than attempts: `allows(key)` says
 * whether the key is still under its limit and spends nothing, `record(key)`
 * counts one failure. Card declines use it — checking on every card attempt
 * costs nothing until a card is actually declined.
 *
 * Never fails open. Every failure is also counted in this instance's own
 * window, and `allows` is false when EITHER that window or Redis says the
 * limit is reached: a Redis outage or timeout (the wait is bounded by
 * REDIS_TIMEOUT_MS) answers from the window, and cannot undo what this
 * instance has counted.
 */
export type FailureLimiter = {
  allows(key: string): Promise<boolean>;
  record(key: string): Promise<void>;
};

type RedisFailureCounter = {
  limit(key: string): Promise<{ success: boolean; reason?: string }>;
  getRemaining(key: string): Promise<{ remaining: number }>;
};

export function createFailureLimiter(
  policy: RateLimitPolicy,
  /** Test seams: the Redis-backed counter (or null for none), and how long to wait for it. */
  deps: { redis?: RedisFailureCounter | null; timeoutMs?: number } = {},
): FailureLimiter {
  const window = new SlidingWindow({ limit: policy.limit, windowMs: policy.windowSeconds * 1000 });
  const timeoutMs = deps.timeoutMs ?? REDIS_TIMEOUT_MS;
  let counter: RedisFailureCounter | null | undefined = deps.redis;

  function getCounter(): RedisFailureCounter | null {
    if (counter !== undefined) return counter;
    const redis = getRedis();
    counter = redis
      ? new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(policy.limit, `${policy.windowSeconds} s`),
          prefix: policy.prefix,
          timeout: timeoutMs,
        })
      : null;
    return counter;
  }

  return {
    async allows(key: string): Promise<boolean> {
      if (!window.allows(key)) return false;
      const redis = getCounter();
      if (!redis) return true;
      try {
        return (await withinTimeout(redis.getRemaining(key), timeoutMs)).remaining > 0;
      } catch (err) {
        // Down or silent: this instance's own count has already answered.
        console.error(`[rate-limit] ${policy.prefix} Redis unavailable, using in-memory fallback:`, err instanceof Error ? err.message : 'unknown');
        return true;
      }
    },
    async record(key: string): Promise<void> {
      window.check(key);
      const redis = getCounter();
      if (!redis) return;
      try {
        await withinTimeout(redis.limit(key), timeoutMs);
      } catch (err) {
        console.error(`[rate-limit] ${policy.prefix} Redis unavailable, counted in memory only:`, err instanceof Error ? err.message : 'unknown');
      }
    },
  };
}

// --- Shared policies -------------------------------------------------------
// Values preserve the limits each call site used before this module existed.

export const loginLimiter = createRateLimiter({ prefix: 'rl:login', limit: 5, windowSeconds: 15 * 60 });
// Per-ACCOUNT buckets, checked alongside the per-IP ones. Keyed by IP alone,
// an attacker with many addresses gets a fresh budget for the same account
// from each of them. Anyone can spend an account's budget, so a browser that
// has signed in to the account before skips the login bucket
// (lib/login-device.ts), and the windows stay short: there is no lock an
// administrator has to lift. Google sign-in is not counted here.
export const loginAccountLimiter = createRateLimiter({ prefix: 'rl:login-acct', limit: 10, windowSeconds: 15 * 60 });
export const passwordResetAccountLimiter = createRateLimiter({ prefix: 'rl:pwreset-acct', limit: 3, windowSeconds: 60 * 60 });

/** Bucket key for an account, so Redis keys never carry the address itself. */
export function accountRateLimitKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

export const registerLimiter = createRateLimiter({ prefix: 'rl:register', limit: 5, windowSeconds: 15 * 60 });

/**
 * One daily budget per client address, SHARED by every public form that sends
 * an email: registration (its confirmation link), verification resends and
 * password-reset requests. Each form's short window alone still let one
 * address send hundreds of emails a day, and the provider's daily allowance
 * (100 on Resend's free plan) is the same one booking confirmations need.
 * Checked on top of each form's own limits, never instead of them.
 */
export const EMAIL_SEND_DAILY_POLICY: RateLimitPolicy = { prefix: 'rl:email-ip-day', limit: 20, windowSeconds: 24 * 60 * 60 };
/**
 * The ceiling across every address together. Per-address limits alone let a few
 * addresses spend the whole of Resend Free's 100 a day, and the salon stays on
 * Free (owner, 2026-10-25), so at least 60 a day are kept for booking mail.
 * Real sign-ups and resets come to a handful a day.
 */
export const EMAIL_SEND_SITE_DAILY_POLICY: RateLimitPolicy = { prefix: 'rl:email-site-day', limit: 40, windowSeconds: 24 * 60 * 60 };
const emailSendPerAddress = createRateLimiter(EMAIL_SEND_DAILY_POLICY);
const emailSendSiteWide = createRateLimiter(EMAIL_SEND_SITE_DAILY_POLICY);
/** Per address first, so an address already over its cap spends none of the shared budget. */
export const emailSendDailyLimiter: RateLimiter = {
  backend: () => emailSendPerAddress.backend(),
  check: async (ip) => (await emailSendPerAddress.check(ip)) && emailSendSiteWide.check('site'),
};
export const bookingLimiter = createRateLimiter({ prefix: 'rl:booking', limit: 6, windowSeconds: 60 * 60 });
// Each request and each withdrawal emails the customer (and a request the
// salon too), and a withdrawal frees the slot to be requested again: without a
// daily ceiling one verified account could loop request → withdraw all day
// (security review 2026-10-16). Far above what a real customer does.
export const bookingDailyLimiter = createRateLimiter({ prefix: 'rl:booking-day', limit: 10, windowSeconds: 24 * 60 * 60 });
export const cancelLimiter = createRateLimiter({ prefix: 'rl:cancel', limit: 10, windowSeconds: 24 * 60 * 60 });
// Card step failures the booking page reports (actions/card-check.ts): each
// one is a log line and an audit row, so one account gets a small budget.
export const cardCheckReportLimiter = createRateLimiter({ prefix: 'rl:card-check', limit: 20, windowSeconds: 60 * 60 });
export const discountLimiter = createRateLimiter({ prefix: 'rl:discount', limit: 10, windowSeconds: 15 * 60 });
export const clockLimiter = createRateLimiter({ prefix: 'rl:clock', limit: 8, windowSeconds: 5 * 60 });
export const passwordResetLimiter = createRateLimiter({ prefix: 'rl:pwreset', limit: 5, windowSeconds: 60 * 60 });
// The date strip and time lookups need no sign-in, and each call is three
// database reads. Generous for a person paging weeks and switching stylists.
export const availabilityLimiter = createRateLimiter({ prefix: 'rl:availability', limit: 120, windowSeconds: 10 * 60 });
// Every reschedule request emails the customer and the salon. Per customer, and per
// appointment so one booking cannot be bounced between two times all day.
export const rescheduleLimiter = createRateLimiter({ prefix: 'rl:reschedule', limit: 5, windowSeconds: 60 * 60 });
export const appointmentRescheduleLimiter = createRateLimiter({ prefix: 'rl:reschedule-appt', limit: 3, windowSeconds: 24 * 60 * 60 });

/**
 * Card declines on deposit authorizations (money-safety review I4): a
 * stolen-card tester behind one verified account — or one address, across
 * accounts — gets a few tries a day instead of bookingLimiter's six an hour.
 * Counted only when Square declines a deposit (the attempt ends FAILED,
 * actions/booking.ts); checked before an attempt is written or Square is
 * asked, and a refusal answers PAYMENT_UNAVAILABLE ("call the salon").
 */
export const DEPOSIT_DECLINE_ACCOUNT_POLICY: RateLimitPolicy = { prefix: 'rl:decline-acct', limit: 3, windowSeconds: 24 * 60 * 60 };
export const DEPOSIT_DECLINE_IP_POLICY: RateLimitPolicy = { prefix: 'rl:decline-ip', limit: 5, windowSeconds: 24 * 60 * 60 };
export const depositDeclineAccountLimiter = createFailureLimiter(DEPOSIT_DECLINE_ACCOUNT_POLICY);
export const depositDeclineIpLimiter = createFailureLimiter(DEPOSIT_DECLINE_IP_POLICY);
/**
 * Card authorizations of any outcome from one address, spent BEFORE Square is
 * asked. The decline budgets above are read first and counted only after
 * Square answers, so submissions sent at the same moment — across many
 * accounts on one address — all passed them (security review 2026-10-16).
 * This spends atomically, so a burst can never exceed it. Per account,
 * bookingLimiter and bookingDailyLimiter already spend atomically. Generous,
 * because mobile networks put many customers behind one address.
 */
export const DEPOSIT_AUTHORIZE_IP_POLICY: RateLimitPolicy = { prefix: 'rl:authorize-ip', limit: 20, windowSeconds: 24 * 60 * 60 };
export const depositAuthorizeIpLimiter = createRateLimiter(DEPOSIT_AUTHORIZE_IP_POLICY);
