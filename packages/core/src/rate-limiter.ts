/**
 * Rate Limiter — Sliding-window rate limiter with pluggable backends.
 *
 * Usage:
 *   const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
 *   const result = limiter.check('user-ip-or-key');
 *   if (!result.allowed) { // reject }
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Unix timestamp (seconds) when the window resets */
  resetAt: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
  /** Remove all tracked entries */
  reset(): void;
}

export interface RateLimiterOptions {
  /** Max requests per window (default: 30) */
  limit?: number;
  /** Window duration in ms (default: 60_000) */
  windowMs?: number;
  /** Max tracked keys before eviction (default: 10_000) */
  maxBuckets?: number;
}

/**
 * In-memory sliding-window rate limiter.
 * Each key tracks an array of request timestamps; older entries are pruned.
 */
class MemoryRateLimiter implements RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxBuckets: number;
  private readonly buckets = new Map<string, number[]>();
  private readonly pruneTimer: ReturnType<typeof setInterval>;

  constructor(opts: RateLimiterOptions = {}) {
    this.limit = opts.limit ?? 30;
    this.windowMs = opts.windowMs ?? 60_000;
    this.maxBuckets = opts.maxBuckets ?? 10_000;

    // Prune stale entries every 2 minutes
    this.pruneTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, times] of this.buckets) {
        const active = times.filter(t => now - t < this.windowMs);
        if (active.length === 0) this.buckets.delete(key);
        else this.buckets.set(key, active);
      }
    }, 120_000);
    this.pruneTimer.unref();
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    const timestamps = this.buckets.get(key) || [];
    const recent = timestamps.filter(t => now - t < this.windowMs);

    const remaining = Math.max(0, this.limit - recent.length);
    const resetAt = recent.length > 0
      ? Math.ceil((recent[0] + this.windowMs) / 1000)
      : Math.ceil((now + this.windowMs) / 1000);

    if (recent.length >= this.limit) {
      return { allowed: false, remaining: 0, resetAt };
    }

    // Evict oldest bucket if at capacity
    if (!this.buckets.has(key) && this.buckets.size >= this.maxBuckets) {
      const oldest = this.buckets.keys().next().value;
      if (oldest) this.buckets.delete(oldest);
    }

    recent.push(now);
    this.buckets.set(key, recent);
    return { allowed: true, remaining: remaining - 1, resetAt };
  }

  reset(): void {
    this.buckets.clear();
  }
}

export function createRateLimiter(opts?: RateLimiterOptions): RateLimiter {
  return new MemoryRateLimiter(opts);
}
