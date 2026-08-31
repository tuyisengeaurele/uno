import type { AddressInfo } from 'node:net';

import type { ClientToServerEvents, Result, ServerToClientEvents } from '@uno/contracts';
import { pino } from 'pino';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

import { createApp, type AppHandle } from '../app.js';
import type { Config } from '../config.js';

export type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

export interface TestServer extends AppHandle {
  url: string;
}

export async function startTestServer(overrides: Partial<Config> = {}): Promise<TestServer> {
  const config: Config = {
    nodeEnv: 'test',
    port: 0,
    corsOrigins: ['http://localhost:5173'],
    logLevel: 'silent',
    roomIdleMs: 3_600_000,
    ...overrides,
  };

  const app = createApp(config, pino({ level: 'silent' }));
  await new Promise<void>((resolve) => {
    app.httpServer.listen(0, resolve);
  });
  const port = (app.httpServer.address() as AddressInfo).port;

  return { ...app, url: `http://127.0.0.1:${String(port)}` };
}

export function connect(url: string): TestClient {
  return ioClient(url, { transports: ['websocket'], forceNew: true });
}

export async function connected(url: string): Promise<TestClient> {
  const socket = connect(url);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => {
      resolve();
    });
    socket.once('connect_error', (err: Error) => {
      reject(new Error(`connect_error: ${err.message}`));
    });
  });
  return socket;
}

/** Emit an event and resolve with its ack. Works for events with or without a payload. */
export function emitAck<T>(
  socket: TestClient,
  event: keyof ClientToServerEvents,
  payload?: unknown,
): Promise<Result<T>> {
  return new Promise((resolve) => {
    const handler = resolve as (r: Result<T>) => void;
    if (payload === undefined) {
      (socket.emit as (e: string, ack: unknown) => void)(event, handler);
    } else {
      (socket.emit as (e: string, p: unknown, ack: unknown) => void)(event, payload, handler);
    }
  });
}

/** Resolve with the next payload for `event`. */
export function nextEvent<T>(socket: TestClient, event: keyof ServerToClientEvents): Promise<T> {
  return new Promise((resolve) => {
    (socket.once as (e: string, cb: (p: T) => void) => void)(event, resolve);
  });
}

export function closeClients(...clients: TestClient[]): void {
  for (const client of clients) {
    client.close();
  }
}
