import { pino, type Logger } from 'pino';

import type { Config } from './config.js';

export type { Logger };

export function createLogger(config: Config): Logger {
  return pino({
    level: config.logLevel,
    ...(config.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
      : {}),
  });
}
