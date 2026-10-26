import 'server-only';
import { Redis } from '@upstash/redis';
import { z } from 'zod';
import { resolveRedisCredentials } from '@/app/lib/redis-credentials';
import type { FreshaWatchState, FreshaWatchStore } from './fresha-watch';

// The watch's memory lives in Upstash, not Neon: reading it every 5 minutes
// must not wake the database. One key, so a tick is one read (and one write
// only when something changed): about 4,000 commands a month in staff hours.
const KEY = 'fresha-watch:v1';
/** A lost key only means one extra import of each feed; a week keeps it across a quiet spell. */
const TTL_SECONDS = 7 * 24 * 60 * 60;
const TIMEOUT_MS = 1_500;

const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const instant = z.number().int().nonnegative();
const stateSchema = z.object({
  feeds: z.record(z.string().min(1).max(128), z.object({
    imported: fingerprint.optional(),
    mirrored: fingerprint.optional(),
    feedRetryAt: instant.optional(),
    mirrorRetryAt: instant.optional(),
  })),
  importTicks: z.array(instant).max(100),
});

/** Null without Redis credentials: the watch then does nothing. Reads the environment when called. */
export function freshaWatchStore(env: NodeJS.ProcessEnv = process.env): FreshaWatchStore | null {
  const credentials = resolveRedisCredentials(env);
  if (!credentials) return null;
  const redis = new Redis({ ...credentials, retry: false, signal: () => AbortSignal.timeout(TIMEOUT_MS) });
  return {
    async read() {
      const raw = await redis.get<unknown>(KEY);
      if (raw === null) return null;
      const parsed = stateSchema.safeParse(raw);
      // Unreadable state is treated as none: each feed is imported once more.
      return parsed.success ? parsed.data : null;
    },
    async write(state: FreshaWatchState) {
      await redis.set(KEY, state, { ex: TTL_SECONDS });
    },
  };
}
