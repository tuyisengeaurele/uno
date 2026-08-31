import type { AddressInfo } from 'node:net';

import type {
  ClientToServerEvents,
  GameActionInput,
  PlayerView,
  Result,
  ServerToClientEvents,
} from '@uno/contracts';
import { canPlayOn, type CardColor } from '@uno/engine';
import { pino } from 'pino';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

import { createApp, type AppHandle, type AppOverrides } from '../app.js';
import type { Config } from '../config.js';
import { createTurnTimers } from '../turns/timer.js';

export type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

export interface TestServer extends AppHandle {
  url: string;
}

export interface TestServerOptions {
  config?: Partial<Config>;
  /** Cap every turn timer at this many ms so timeout tests run fast. */
  maxTurnTimerMs?: number;
}

export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const config: Config = {
    nodeEnv: 'test',
    port: 0,
    corsOrigins: ['http://localhost:5173'],
    logLevel: 'silent',
    roomIdleMs: 3_600_000,
    ...options.config,
  };

  const appOverrides: AppOverrides = {};
  if (options.maxTurnTimerMs !== undefined) {
    const cap = options.maxTurnTimerMs;
    appOverrides.turnTimers = createTurnTimers({
      set: (fn, ms) => setTimeout(fn, Math.min(ms, cap)),
      clear: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    });
  }

  const app = createApp(config, pino({ level: 'silent' }), appOverrides);
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

const COLORS: CardColor[] = ['red', 'yellow', 'green', 'blue'];

function preferredColor(hand: PlayerView['self']['hand']): CardColor {
  for (const color of COLORS) {
    if (hand.some((card) => 'color' in card && card.color === color)) {
      return color;
    }
  }
  return 'red';
}

/**
 * Pick one legal action for a player, using only what their view exposes. This
 * is exactly the information a real client would have.
 */
export function chooseMove(view: PlayerView): GameActionInput {
  const { board, self } = view;
  if (board === null) {
    throw new Error('no board to move against');
  }
  const id = self.id;

  if (board.awaitingColorChoiceFrom === id) {
    return { type: 'choose-color', playerId: id, color: preferredColor(self.hand) };
  }

  if (self.drawnCard !== null) {
    return self.drawnCard.playable
      ? {
          type: 'play-drawn',
          playerId: id,
          cardId: self.drawnCard.cardId,
          ...wildColor(self, self.drawnCard.cardId),
        }
      : { type: 'pass', playerId: id };
  }

  if (board.pendingDraw > 0) {
    return { type: 'draw', playerId: id };
  }

  const activeColor = board.activeColor;
  if (activeColor !== null) {
    const playable = self.hand.find((card) => canPlayOn(card, board.discardTop, activeColor));
    if (playable !== undefined) {
      return {
        type: 'play-card',
        playerId: id,
        cardId: playable.id,
        ...wildColor(self, playable.id),
      };
    }
  }

  return { type: 'draw', playerId: id };
}

function wildColor(self: PlayerView['self'], cardId: string): { chosenColor?: CardColor } {
  const card = self.hand.find((c) => c.id === cardId);
  return card !== undefined && (card.kind === 'wild' || card.kind === 'wild-draw-four')
    ? { chosenColor: preferredColor(self.hand) }
    : {};
}
