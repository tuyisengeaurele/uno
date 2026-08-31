import type { GameErrorCode } from '@uno/engine';

/** Transport and room-level failures, distinct from the engine's rule errors. */
export type ProtocolErrorCode =
  | 'invalid-payload'
  | 'room-not-found'
  | 'room-full'
  | 'not-host'
  | 'already-started'
  | 'not-in-lobby'
  | 'no-active-round'
  | 'not-a-player'
  | 'wrong-actor'
  | 'rate-limited'
  | 'bad-token'
  | 'too-few-players';

/**
 * An error returned on an ack. `code` is a protocol code for transport problems
 * or an engine `GameErrorCode` when a move was well formed but against the rules.
 */
export interface ProtocolError {
  code: ProtocolErrorCode | GameErrorCode;
  message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ProtocolError };
