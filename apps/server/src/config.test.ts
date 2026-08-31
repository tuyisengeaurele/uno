import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults when the environment is empty', () => {
    const config = loadConfig({});
    expect(config).toEqual({
      nodeEnv: 'development',
      port: 3000,
      corsOrigins: ['http://localhost:5173'],
      logLevel: 'info',
      roomIdleMs: 60 * 60_000,
    });
  });

  it('coerces PORT to a number', () => {
    expect(loadConfig({ PORT: '8080' }).port).toBe(8080);
  });

  it('splits CORS_ORIGIN into a trimmed list', () => {
    expect(loadConfig({ CORS_ORIGIN: 'https://a.com, https://b.com' }).corsOrigins).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('converts ROOM_IDLE_MINUTES to milliseconds', () => {
    expect(loadConfig({ ROOM_IDLE_MINUTES: '30' }).roomIdleMs).toBe(30 * 60_000);
  });

  it('throws with a message naming the bad field', () => {
    expect(() => loadConfig({ PORT: 'banana' })).toThrow(/PORT/);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });
});
