export interface RateLimiter {
  /** Consume one token for `key`. Returns false when the bucket is empty. */
  tryConsume(key: string, now: number): boolean;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * A token bucket per key. Starts full at `capacity` and refills continuously at
 * `refillPerSecond`. Used to cap room creation and reconnect attempts per IP.
 */
export function createRateLimiter(opts: {
  capacity: number;
  refillPerSecond: number;
}): RateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    tryConsume(key, now) {
      const bucket = buckets.get(key) ?? { tokens: opts.capacity, updatedAt: now };
      const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
      const tokens = Math.min(opts.capacity, bucket.tokens + elapsedSeconds * opts.refillPerSecond);

      if (tokens < 1) {
        buckets.set(key, { tokens, updatedAt: now });
        return false;
      }

      buckets.set(key, { tokens: tokens - 1, updatedAt: now });
      return true;
    },
  };
}
