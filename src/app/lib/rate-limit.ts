import 'server-only';
import { createHash } from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { SlidingWindow } from '@/app/lib/sliding-window';
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
export const bookingLimiter = createRateLimiter({ prefix: 'rl:booking', limit: 6, windowSeconds: 60 * 60 });
export const discountLimiter = createRateLimiter({ prefix: 'rl:discount', limit: 10, windowSeconds: 15 * 60 });
export const clockLimiter = createRateLimiter({ prefix: 'rl:clock', limit: 8, windowSeconds: 5 * 60 });
export const passwordResetLimiter = createRateLimiter({ prefix: 'rl:pwreset', limit: 5, windowSeconds: 60 * 60 });
