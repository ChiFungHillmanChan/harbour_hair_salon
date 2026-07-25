// Pure, dependency-free sliding-window rate limiter used as the in-process
// fallback when Upstash Redis is not configured.
//
// Deliberately NOT a drop-in replacement for the Redis limiter: this counter
// lives in one serverless instance's memory, so it resets on cold start and is
// not shared across concurrent instances. It is a floor, not a ceiling — but a
// weak limit is vastly better than the previous behaviour, where an unset
// UPSTASH_* env silently turned booking/discount/newsletter limiting OFF.

export type SlidingWindowOptions = {
  /** Maximum number of allowed hits inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Cap on tracked keys, so a flood of unique IPs cannot grow the map without
   * bound. When exceeded, fully-expired keys are dropped first; if that is not
   * enough, the least-recently-touched keys go.
   */
  maxKeys?: number;
};

const DEFAULT_MAX_KEYS = 10_000;

export class SlidingWindow {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor({ limit, windowMs, maxKeys = DEFAULT_MAX_KEYS }: SlidingWindowOptions) {
    if (limit < 1) throw new Error('SlidingWindow limit must be >= 1');
    if (windowMs < 1) throw new Error('SlidingWindow windowMs must be >= 1');
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  /**
   * Record an attempt for `key` and report whether it is allowed.
   * Returns false once `limit` attempts have already landed inside the window.
   */
  check(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= this.limit) {
      // Refresh position so an actively-attacking key is not evicted first.
      this.hits.delete(key);
      this.hits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.hits.delete(key);
    this.hits.set(key, recent);
    this.evictIfNeeded(now);
    return true;
  }

  /** Tracked-key count. Exposed for tests and diagnostics. */
  size(): number {
    return this.hits.size;
  }

  private evictIfNeeded(now: number): void {
    if (this.hits.size <= this.maxKeys) return;

    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
        this.hits.delete(key);
      }
    }

    // Map preserves insertion order and `check` re-inserts on every touch, so
    // iterating from the front yields least-recently-touched keys first.
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next();
      if (oldest.done) break;
      this.hits.delete(oldest.value);
    }
  }
}
