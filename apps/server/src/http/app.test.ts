import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { defaultHouseRules } from '@uno/engine';

import type { Config } from '../config.js';
import { createInMemoryRoomStore } from '../rooms/memory-store.js';
import { createRoom } from '../rooms/room.js';
import type { RoomStore } from '../rooms/store.js';
import { createHttpApp } from './app.js';

const config: Config = {
  nodeEnv: 'test',
  port: 0,
  corsOrigins: ['https://play.uno.example'],
  logLevel: 'silent',
  roomIdleMs: 3_600_000,
};

let store: RoomStore;
let baseUrl: string;
let close: () => Promise<void>;

beforeEach(async () => {
  store = createInMemoryRoomStore();
  const app = createHttpApp({ store, config, logger: pino({ level: 'silent' }) });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  close = () =>
    new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
});

afterEach(async () => {
  await close();
});

const seedRoom = (code: string) => {
  store.create(
    createRoom({
      code,
      hostName: 'Ada',
      houseRules: defaultHouseRules(),
      turnTimerSeconds: 45,
      seed: 1,
      now: Date.now(),
    }),
  );
};

describe('GET /health', () => {
  it('reports status ok and the room count', async () => {
    seedRoom('ABCJK2');
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; rooms: number };
    expect(body.status).toBe('ok');
    expect(body.rooms).toBe(1);
  });
});

describe('GET /rooms/:code', () => {
  it('returns a summary with no hand data', async () => {
    seedRoom('ABCJK2');
    const res = await fetch(`${baseUrl}/rooms/ABCJK2`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('hand');
    expect(JSON.parse(text)).toMatchObject({ code: 'ABCJK2', phase: 'lobby', seatCount: 1 });
  });

  it('returns 404 for an unknown room', async () => {
    const res = await fetch(`${baseUrl}/rooms/NOPE00`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'room-not-found' });
  });
});

describe('security middleware', () => {
  it('sets helmet headers', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('allows a configured origin and not others', async () => {
    const allowed = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'https://play.uno.example' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://play.uno.example');

    const denied = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});
