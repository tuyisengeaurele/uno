import type { AddressInfo } from 'node:net';

import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { Config } from './config.js';

const config: Config = {
  nodeEnv: 'test',
  port: 0,
  corsOrigins: ['http://localhost:5173'],
  logLevel: 'silent',
  roomIdleMs: 3_600_000,
};

const listen = (app: ReturnType<typeof createApp>): Promise<number> =>
  new Promise((resolve) => {
    app.httpServer.listen(0, () => {
      resolve((app.httpServer.address() as AddressInfo).port);
    });
  });

describe('createApp', () => {
  it('serves the health check once listening', async () => {
    const app = createApp(config, pino({ level: 'silent' }));
    const port = await listen(app);
    try {
      const res = await fetch(`http://127.0.0.1:${String(port)}/health`);
      expect(res.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('stops serving after close', async () => {
    const app = createApp(config, pino({ level: 'silent' }));
    const port = await listen(app);
    await app.close();

    await expect(fetch(`http://127.0.0.1:${String(port)}/health`)).rejects.toThrow();
  });

  it('can be created twice with no shared state', async () => {
    const a = createApp(config, pino({ level: 'silent' }));
    const b = createApp(config, pino({ level: 'silent' }));
    const [portA, portB] = await Promise.all([listen(a), listen(b)]);

    expect(portA).not.toBe(portB);
    await Promise.all([a.close(), b.close()]);
  });
});
