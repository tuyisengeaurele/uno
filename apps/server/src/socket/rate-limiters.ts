import { createRateLimiter, type RateLimiter } from './rate-limit.js';

export interface RateLimiters {
  create: RateLimiter;
  reconnect: RateLimiter;
}

/** The tuned per-IP limits shared by the app and the test harness. */
export function createRateLimiters(): RateLimiters {
  return {
    create: createRateLimiter({ capacity: 5, refillPerSecond: 5 / 60 }),
    reconnect: createRateLimiter({ capacity: 10, refillPerSecond: 10 / 60 }),
  };
}
