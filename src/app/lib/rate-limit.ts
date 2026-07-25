import 'server-only';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { SlidingWindow } from '@/app/lib/sliding-window';

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
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  redisClient = url && token ? new Redis({ url, token }) : null;

  if (!redisClient && !warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      '[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set — falling back to ' +
        'per-instance in-memory limiting. This resets on cold start and is not ' +
        'shared across serverless instances. Configure Upstash for real limits.',
    );
  }
  return redisClient;
}

/**
 * Build a limiter for one policy. Cheap to call at module scope in a server
 * action file: the Redis client and window are created lazily on first check.
 */
export function createRateLimiter(policy: RateLimitPolicy): RateLimiter {
  const fallback = new SlidingWindow({
    limit: policy.limit,
    windowMs: policy.windowSeconds * 1000,
  });

  let redisLimiter: Ratelimit | null | undefined;
  let lastBackend: 'redis' | 'memory' = 'memory';

  function getRedisLimiter(): Ratelimit | null {
    if (redisLimiter !== undefined) return redisLimiter;
    const redis = getRedis();
    redisLimiter = redis
      ? new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(policy.limit, `${policy.windowSeconds} s`),
          prefix: policy.prefix,
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
          const { success } = await limiter.limit(key);
          lastBackend = 'redis';
          return success;
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
export const registerLimiter = createRateLimiter({ prefix: 'rl:register', limit: 5, windowSeconds: 15 * 60 });
export const bookingLimiter = createRateLimiter({ prefix: 'rl:booking', limit: 6, windowSeconds: 60 * 60 });
export const discountLimiter = createRateLimiter({ prefix: 'rl:discount', limit: 10, windowSeconds: 15 * 60 });
export const newsletterLimiter = createRateLimiter({ prefix: 'rl:newsletter', limit: 3, windowSeconds: 60 * 60 });
export const clockLimiter = createRateLimiter({ prefix: 'rl:clock', limit: 8, windowSeconds: 5 * 60 });
export const passwordResetLimiter = createRateLimiter({ prefix: 'rl:pwreset', limit: 5, windowSeconds: 60 * 60 });
