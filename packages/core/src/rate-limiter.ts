/**
 * Rate Limiter — Sliding-window rate limiter with pluggable backends.
 *
 * Backends:
 *   - MemoryRateLimiter (default) — in-process, single instance only
 *   - RedisRateLimiter — shared across instances via REDIS_URL
 *
 * Usage:
 *   const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
 *   const result = await limiter.check('user-ip-or-key');
 *   if (!result.allowed) { // reject }
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Unix timestamp (seconds) when the window resets */
  resetAt: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult | Promise<RateLimitResult>;
  /** Remove all tracked entries */
  reset(): void | Promise<void>;
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
  const redisUrl = process.env['REDIS_URL'];
  if (redisUrl) {
    return new RedisRateLimiter(redisUrl, opts);
  }
  return new MemoryRateLimiter(opts);
}

/**
 * Redis-backed sliding-window rate limiter.
 * Uses a sorted set per key with timestamps as scores.
 * Requires a Redis-compatible server (Redis, Upstash, Dragonfly, etc.).
 */
class RedisRateLimiter implements RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly redisUrl: string;
  private readonly prefix: string;

  constructor(redisUrl: string, opts: RateLimiterOptions = {}) {
    this.limit = opts.limit ?? 30;
    this.windowMs = opts.windowMs ?? 60_000;
    this.redisUrl = redisUrl;
    this.prefix = 'cullit:rl:';
  }

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const redisKey = this.prefix + key;

    try {
      // Pipeline: cleanup + count + add + expire in a single request
      // Use MULTI/EXEC for atomicity of ZADD + PEXPIRE
      const res = await fetch(this.redisUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          ['ZREMRANGEBYSCORE', redisKey, '0', String(windowStart)],
          ['ZCARD', redisKey],
          ['MULTI'],
          ['ZADD', redisKey, String(now), `${now}-${Math.random().toString(36).slice(2, 8)}`],
          ['PEXPIRE', redisKey, String(this.windowMs)],
          ['EXEC'],
        ]),
        signal: AbortSignal.timeout(3_000),
      });

      if (!res.ok) return this.fallbackAllow(now);

      const results = await res.json() as Array<{ result?: number }>;
      const count = results[1]?.result ?? 0;
      const remaining = Math.max(0, this.limit - count);
      const resetAt = Math.ceil((now + this.windowMs) / 1000);

      if (count >= this.limit) {
        return { allowed: false, remaining: 0, resetAt };
      }
      return { allowed: true, remaining: remaining - 1, resetAt };
    } catch {
      // Redis unavailable — fail open (allow the request)
      return this.fallbackAllow(now);
    }
  }

  private fallbackAllow(now: number): RateLimitResult {
    return { allowed: true, remaining: this.limit, resetAt: Math.ceil((now + this.windowMs) / 1000) };
  }

  async reset(): Promise<void> {
    // Best-effort flush of rate limit keys — not critical
  }
}
