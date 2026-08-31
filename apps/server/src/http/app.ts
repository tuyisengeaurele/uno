import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import type { Config } from '../config.js';
import { toRoomSummary } from '../game/redact.js';
import type { Logger } from '../logger.js';
import type { RoomStore } from '../rooms/store.js';

export interface HttpDeps {
  store: RoomStore;
  config: Config;
  logger: Logger;
}

export function createHttpApp(deps: HttpDeps): Express {
  const app = express();
  const startedAt = Date.now();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: deps.config.corsOrigins }));
  app.use(express.json({ limit: '16kb' }));
  app.use(pinoHttp({ logger: deps.logger }));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      rooms: deps.store.list().length,
    });
  });

  app.get<{ code: string }>('/rooms/:code', (req, res) => {
    const room = deps.store.get(req.params.code);
    if (room === undefined) {
      res.status(404).json({ error: 'room-not-found' });
      return;
    }
    res.json(toRoomSummary(room));
  });

  return app;
}
