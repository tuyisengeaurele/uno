import { describe, expect, it } from 'vitest';

import type { Config } from './config.js';
import { createLogger } from './logger.js';

const config = (overrides: Partial<Config> = {}): Config => ({
  nodeEnv: 'test',
  port: 3000,
  corsOrigins: ['http://localhost:5173'],
  logLevel: 'warn',
  roomIdleMs: 3_600_000,
  ...overrides,
});

describe('createLogger', () => {
  it('honours the configured level', () => {
    expect(createLogger(config({ logLevel: 'error' })).level).toBe('error');
  });

  it('builds a pretty logger in development without throwing', () => {
    expect(() => createLogger(config({ nodeEnv: 'development' }))).not.toThrow();
  });
});
