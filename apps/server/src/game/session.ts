import {
  applyAction,
  createRng,
  startNextRound,
  startRound,
  type GameAction,
  type GameEvent,
} from '@uno/engine';
import type { GameActionInput } from '@uno/contracts';

import { protocolError, type ProtocolError } from '../errors.js';
import { canStart, type Room } from '../rooms/room.js';

/**
 * The parsed input and the engine action have the same runtime shape. They
 * differ only in how the optional `chosenColor` is typed under
 * `exactOptionalPropertyTypes`, which does not matter once zod has parsed it.
 */
function asEngineAction(input: GameActionInput): GameAction {
  return input as GameAction;
}

function actorOf(action: GameActionInput): string {
  switch (action.type) {
    case 'catch-unfair-uno':
      return action.accuserId;
    case 'challenge-wild-four':
      return action.challengerId;
    default:
      return action.playerId;
  }
}

export interface EndInfo {
  winnerId: string;
  scores: Record<string, number>;
}

type EndEvent = Extract<GameEvent, { type: 'round-ended' | 'match-ended' }>;

function endFrom(events: readonly GameEvent[], type: EndEvent['type']): EndInfo | null {
  const event = events.find((e): e is EndEvent => e.type === type);
  return event === undefined ? null : { winnerId: event.winnerId, scores: { ...event.scores } };
}

export function startGame(room: Room, now: number): { room: Room } | { error: ProtocolError } {
  const check = canStart(room);
  if (!check.ok) {
    return { error: protocolError(check.code, 'the round cannot start yet') };
  }

  const rng = createRng(room.seed, room.rngState);
  const { state } = startRound(
    room.seats.map((seat) => ({ id: seat.id, name: seat.name })),
    room.houseRules,
    rng,
  );

  return {
    room: { ...room, phase: 'active', game: state, rngState: rng.state, lastActivityAt: now },
  };
}

export function nextRound(room: Room, now: number): { room: Room } | { error: ProtocolError } {
  const game = room.game;
  if (game === null) {
    return { error: protocolError('no-active-round', 'there is no round to advance from') };
  }
  if (game.status !== 'round-over') {
    return { error: protocolError('no-active-round', 'the current round is not finished') };
  }

  const rng = createRng(room.seed, room.rngState);
  const { state } = startNextRound(game, rng);
  return { room: { ...room, game: state, rngState: rng.state, lastActivityAt: now } };
}

export interface ActionOutcome {
  room: Room;
  events: GameEvent[];
  roundEnded: EndInfo | null;
  matchEnded: EndInfo | null;
}

export function applyPlayerAction(
  room: Room,
  seatId: string,
  action: GameActionInput,
  now: number,
): ActionOutcome | { error: ProtocolError } {
  const game = room.game;
  if (game === null) {
    return { error: protocolError('no-active-round', 'no round is in progress') };
  }
  if (game.status !== 'active') {
    return { error: protocolError('no-active-round', 'the round has ended') };
  }
  if (actorOf(action) !== seatId) {
    return { error: protocolError('wrong-actor', 'you can only act as yourself') };
  }

  const rng = createRng(room.seed, room.rngState);
  const result = applyAction(game, asEngineAction(action), { rng });
  if (!result.ok) {
    return { error: { code: result.error.code, message: result.error.message } };
  }

  return {
    room: { ...room, game: result.state, rngState: rng.state, lastActivityAt: now },
    events: result.events,
    roundEnded: endFrom(result.events, 'round-ended'),
    matchEnded: endFrom(result.events, 'match-ended'),
  };
}
