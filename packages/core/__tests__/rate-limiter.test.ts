import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createRateLimiter } from '../src/rate-limiter';
import type { RateLimiter } from '../src/rate-limiter';

// Force in-memory limiter (no REDIS_URL)
beforeEach(() => {
  delete process.env['REDIS_URL'];
});

describe('MemoryRateLimiter — basic behavior', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = createRateLimiter({ limit: 3, windowMs: 10_000 });
  });

  afterEach(() => {
    limiter.reset();
  });

  it('allows requests under the limit', async () => {
    const r1 = await limiter.check('user-1');
    expect(r1).toMatchObject({ allowed: true });
    expect(r1.remaining).toBe(2);
  });

  it('counts down remaining correctly', async () => {
    await limiter.check('user-2');
    const r2 = await limiter.check('user-2');
    expect(r2).toMatchObject({ allowed: true, remaining: 1 });

    const r3 = await limiter.check('user-2');
    expect(r3).toMatchObject({ allowed: true, remaining: 0 });
  });

  it('rejects when limit is reached', async () => {
    await limiter.check('user-3');
    await limiter.check('user-3');
    await limiter.check('user-3');
    const r4 = await limiter.check('user-3');
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it('tracks keys independently', async () => {
    await limiter.check('alice');
    await limiter.check('alice');
    await limiter.check('alice');

    const bob = await limiter.check('bob');
    expect(bob.allowed).toBe(true);
    expect(bob.remaining).toBe(2);
  });

  it('provides a resetAt timestamp', async () => {
    const now = Math.ceil(Date.now() / 1000);
    const r = await limiter.check('ts-user');
    // resetAt should be ~10s in the future (within margin)
    expect(r.resetAt).toBeGreaterThanOrEqual(now);
    expect(r.resetAt).toBeLessThanOrEqual(now + 15);
  });
});

describe('MemoryRateLimiter — window expiry', () => {
  it('allows requests again after the window expires', async () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter({ limit: 2, windowMs: 5_000 });

    await limiter.check('user-window');
    await limiter.check('user-window');
    expect((await limiter.check('user-window')).allowed).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(5_001);
    const after = await limiter.check('user-window');
    expect(after.allowed).toBe(true);

    limiter.reset();
    vi.useRealTimers();
  });
});

describe('MemoryRateLimiter — bucket eviction', () => {
  it('evicts the oldest bucket when maxBuckets is reached', async () => {
    const limiter = createRateLimiter({ limit: 10, windowMs: 60_000, maxBuckets: 3 });

    await limiter.check('a');
    await limiter.check('b');
    await limiter.check('c');
    // 'd' should evict 'a'
    await limiter.check('d');

    // 'a' was evicted so it gets a fresh bucket
    const aResult = await limiter.check('a');
    expect(aResult.allowed).toBe(true);
    expect(aResult.remaining).toBe(9); // fresh bucket, first request

    limiter.reset();
  });
});

describe('MemoryRateLimiter — reset', () => {
  it('clears all tracked state', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    await limiter.check('reset-user');
    expect((await limiter.check('reset-user')).allowed).toBe(false);

    limiter.reset();
    expect((await limiter.check('reset-user')).allowed).toBe(true);
  });
});
