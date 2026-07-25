// Pure resolution of the Upstash REST credentials from the environment.
//
// Two naming schemes are in play and both must work:
//   - UPSTASH_REDIS_REST_URL / _TOKEN — what Upstash's own docs and the
//     @upstash/ratelimit examples use, and what someone setting this up by hand
//     from the Upstash console would paste in.
//   - KV_REST_API_URL / KV_REST_API_TOKEN — what the Vercel Marketplace
//     integration (`vercel integration add upstash/upstash-kv`) actually
//     injects. This is the pair present in this project.
//
// Preferring the explicit UPSTASH_* names means a hand-set override wins over
// the integration's, which is the useful precedence when pointing a preview
// environment at a different Redis.
//
// Dependency-free so it can be unit-tested without touching process.env.

export type RedisCredentials = { url: string; token: string };

type EnvLike = Partial<Record<string, string | undefined>>;

function firstNonEmpty(env: EnvLike, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export const REDIS_URL_KEYS = ['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'] as const;
export const REDIS_TOKEN_KEYS = ['UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN'] as const;

/**
 * Returns the REST credentials, or null when either half is missing.
 *
 * Both halves are required: a URL without a token (or vice versa) would
 * construct a client that fails on every call, which is worse than cleanly
 * falling back to in-process rate limiting.
 *
 * Note the read-only token (KV_REST_API_READ_ONLY_TOKEN) is deliberately NOT
 * accepted — rate limiting writes counters.
 */
export function resolveRedisCredentials(env: EnvLike): RedisCredentials | null {
  const url = firstNonEmpty(env, [...REDIS_URL_KEYS]);
  const token = firstNonEmpty(env, [...REDIS_TOKEN_KEYS]);
  if (!url || !token) return null;
  return { url, token };
}
