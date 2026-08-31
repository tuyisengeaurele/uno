import type {
  AnyView,
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@uno/contracts';
import type { GameEvent } from '@uno/engine';
import type { Server, Socket } from 'socket.io';

import type { Config } from '../config.js';
import { toPlayerView, toSpectatorView } from '../game/redact.js';
import type { Logger } from '../logger.js';
import type { Room } from '../rooms/room.js';
import type { RoomStore } from '../rooms/store.js';
import type { TokenRegistry } from '../rooms/tokens.js';
import type { TurnTimers } from '../turns/timer.js';
import type { RateLimiter } from './rate-limit.js';

type NoProps = Record<string, never>;

export type UnoServer = Server<ClientToServerEvents, ServerToClientEvents, NoProps, SocketData>;
export type UnoSocket = Socket<ClientToServerEvents, ServerToClientEvents, NoProps, SocketData>;

export interface SocketDeps {
  io: UnoServer;
  store: RoomStore;
  tokens: TokenRegistry;
  logger: Logger;
  config: Config;
  rateLimiters: { create: RateLimiter; reconnect: RateLimiter };
  turnTimers: TurnTimers;
  now: () => number;
}

export interface HandlerContext extends SocketDeps {
  socket: UnoSocket;
}

export function clientIp(socket: UnoSocket): string {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.replace(/,.*$/s, '').trim();
  }
  return socket.handshake.address;
}

async function membersOf(
  io: UnoServer,
  code: string,
): Promise<{ data: SocketData; emit: UnoSocket['emit'] }[]> {
  const sockets = await io.in(code).fetchSockets();
  return sockets.map((member) => ({
    data: member.data,
    emit: member.emit.bind(member),
  }));
}

function viewForData(data: SocketData, room: Room): AnyView {
  return data.seatId !== null ? toPlayerView(room, data.seatId) : toSpectatorView(room);
}

export async function broadcastStarted(io: UnoServer, room: Room): Promise<void> {
  for (const member of await membersOf(io, room.code)) {
    member.emit('game:started', { view: viewForData(member.data, room) });
  }
}

export async function broadcastDelta(
  io: UnoServer,
  room: Room,
  events: GameEvent[],
  autoPlayed?: string,
): Promise<void> {
  for (const member of await membersOf(io, room.code)) {
    const view = viewForData(member.data, room);
    member.emit(
      'game:delta',
      autoPlayed === undefined ? { view, events } : { view, events, autoPlayed },
    );
  }
}
