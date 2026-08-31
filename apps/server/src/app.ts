import { createServer, type Server as HttpServer } from 'node:http';

import { Server } from 'socket.io';

import type { Config } from './config.js';
import { createHttpApp } from './http/app.js';
import type { Logger } from './logger.js';
import { createInMemoryRoomStore } from './rooms/memory-store.js';
import type { RoomStore } from './rooms/store.js';
import { createTokenRegistry, type TokenRegistry } from './rooms/tokens.js';
import type { UnoServer } from './socket/context.js';
import { attachSocketServer } from './socket/index.js';
import { createRateLimiters } from './socket/rate-limiters.js';

export interface AppHandle {
  httpServer: HttpServer;
  io: UnoServer;
  store: RoomStore;
  tokens: TokenRegistry;
  close: () => Promise<void>;
}

export function createApp(config: Config, logger: Logger): AppHandle {
  const store = createInMemoryRoomStore();
  const tokens = createTokenRegistry();

  const httpServer = createServer(createHttpApp({ store, config, logger }));
  const io: UnoServer = new Server(httpServer, {
    cors: { origin: config.corsOrigins },
    connectionStateRecovery: {},
  });

  attachSocketServer({
    io,
    store,
    tokens,
    logger,
    config,
    rateLimiters: createRateLimiters(),
    now: () => Date.now(),
  });

  return {
    httpServer,
    io,
    store,
    tokens,
    // io.close() also closes the underlying HTTP server and drops open sockets.
    close: () => io.close(),
  };
}
