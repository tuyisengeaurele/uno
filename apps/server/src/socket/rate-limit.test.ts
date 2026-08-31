import { describe, expect, it } from 'vitest';

import { createRateLimiter } from './rate-limit.js';

describe('createRateLimiter', () => {
  it('allows a full bucket then blocks', () => {
    const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 0.1 });
    expect(limiter.tryConsume('ip', 0)).toBe(true);
    expect(limiter.tryConsume('ip', 0)).toBe(true);
    expect(limiter.tryConsume('ip', 0)).toBe(true);
    expect(limiter.tryConsume('ip', 0)).toBe(false);
  });

  it('refills over time', () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1 });
    limiter.tryConsume('ip', 0);
    limiter.tryConsume('ip', 0);
    expect(limiter.tryConsume('ip', 500)).toBe(false);
    expect(limiter.tryConsume('ip', 1000)).toBe(true);
  });

  it('never overfills after a long idle', () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 5 });
    limiter.tryConsume('ip', 0);
    limiter.tryConsume('ip', 0);
    // A minute later the bucket is back to capacity, not beyond.
    expect(limiter.tryConsume('ip', 60_000)).toBe(true);
    expect(limiter.tryConsume('ip', 60_000)).toBe(true);
    expect(limiter.tryConsume('ip', 60_000)).toBe(false);
  });

  it('keeps buckets independent per key', () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0.1 });
    expect(limiter.tryConsume('a', 0)).toBe(true);
    expect(limiter.tryConsume('b', 0)).toBe(true);
    expect(limiter.tryConsume('a', 0)).toBe(false);
  });
});
