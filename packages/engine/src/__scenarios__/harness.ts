import type { GameAction } from '../actions.js';
import { canPlayOn, isWild, type Card, type CardColor } from '../cards.js';
import type { GameEvent } from '../events.js';
import { createRng, type Rng } from '../rng.js';
import { applyAction, type EngineContext } from '../reducer.js';
import { currentPlayer, type GameState } from '../state.js';

export interface Trace {
  state: GameState;
  events: GameEvent[];
}

/** Apply an exact list of actions, failing loudly if the engine rejects one. */
export function run(start: GameState, actions: GameAction[], ctx: EngineContext): Trace {
  let state = start;
  const events: GameEvent[] = [];

  actions.forEach((action, index) => {
    const result = applyAction(state, action, ctx);
    if (!result.ok) {
      throw new Error(`action ${String(index)} (${action.type}) rejected: ${result.error.code}`);
    }
    state = result.state;
    events.push(...result.events);
  });

  return { state, events };
}

const COLORS: readonly CardColor[] = ['red', 'yellow', 'green', 'blue'];

/** The colour this hand holds the most of, for choosing after a wild. */
function bestColor(hand: readonly Card[]): CardColor {
  const counts = new Map<CardColor, number>();
  for (const card of hand) {
    if (!isWild(card)) {
      counts.set(card.color, (counts.get(card.color) ?? 0) + 1);
    }
  }
  let choice: CardColor = 'red';
  let most = -1;
  for (const color of COLORS) {
    const count = counts.get(color) ?? 0;
    if (count > most) {
      most = count;
      choice = color;
    }
  }
  return choice;
}

/** A single legal action for the player whose turn it is, or null if stuck. */
export function pickMove(state: GameState): GameAction | null {
  const player = currentPlayer(state);

  if (state.pendingColorChoice === player.id) {
    return { type: 'choose-color', playerId: player.id, color: bestColor(player.hand) };
  }

  if (state.drawnCard?.playerId === player.id) {
    const drawn = player.hand.find((c) => c.id === state.drawnCard?.cardId);
    if (drawn !== undefined && state.drawnCard.playable) {
      return {
        type: 'play-drawn',
        playerId: player.id,
        cardId: drawn.id,
        ...(isWild(drawn) ? { chosenColor: bestColor(player.hand) } : {}),
      };
    }
    return { type: 'pass', playerId: player.id };
  }

  if (state.pendingDraw > 0) {
    return { type: 'draw', playerId: player.id };
  }

  const top = state.discardPile.at(-1);
  const activeColor = state.activeColor;
  if (top !== undefined && activeColor !== null) {
    const playable = player.hand.find((card) => canPlayOn(card, top, activeColor));
    if (playable !== undefined) {
      return {
        type: 'play-card',
        playerId: player.id,
        cardId: playable.id,
        ...(isWild(playable) ? { chosenColor: bestColor(player.hand) } : {}),
      };
    }
  }

  return { type: 'draw', playerId: player.id };
}

const ALL_COLORS: readonly CardColor[] = ['red', 'yellow', 'green', 'blue'];

/**
 * Every legal action for the player whose turn it is. Used by the property
 * tests to check that anything the engine says is legal actually applies.
 */
export function legalMoves(state: GameState): GameAction[] {
  const player = currentPlayer(state);
  const moves: GameAction[] = [];

  if (state.pendingColorChoice === player.id) {
    return ALL_COLORS.map((color) => ({ type: 'choose-color', playerId: player.id, color }));
  }

  if (state.drawnCard?.playerId === player.id) {
    if (state.drawnCard.playable) {
      const drawn = player.hand.find((c) => c.id === state.drawnCard?.cardId);
      if (drawn !== undefined) {
        moves.push(...playVariants('play-drawn', player.id, drawn));
      }
    }
    moves.push({ type: 'pass', playerId: player.id });
    return moves;
  }

  moves.push({ type: 'draw', playerId: player.id });

  const top = state.discardPile.at(-1);
  if (top !== undefined && state.pendingDraw === 0 && state.activeColor !== null) {
    const activeColor = state.activeColor;
    for (const c of player.hand) {
      if (canPlayOn(c, top, activeColor)) {
        moves.push(...playVariants('play-card', player.id, c));
      }
    }
  }

  if (player.hand.length <= 2 && player.hand.length >= 1) {
    moves.push({ type: 'call-uno', playerId: player.id });
  }

  return moves;
}

function playVariants(type: 'play-card' | 'play-drawn', playerId: string, c: Card): GameAction[] {
  if (isWild(c)) {
    return ALL_COLORS.map((color) => ({ type, playerId, cardId: c.id, chosenColor: color }));
  }
  return [{ type, playerId, cardId: c.id }];
}

/**
 * Play the round out with the simple heuristic above. Stops when the round or
 * match ends, or after `maxTurns` as a guard against a stuck game.
 */
export function autoPlayRound(state: GameState, rng: Rng, maxTurns = 400): Trace {
  const ctx: EngineContext = { rng };
  let current = state;
  const events: GameEvent[] = [];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (current.status !== 'active') {
      return { state: current, events };
    }

    const player = currentPlayer(current);
    if (player.hand.length === 2) {
      const called = applyAction(current, { type: 'call-uno', playerId: player.id }, ctx);
      /* c8 ignore next 3 -- calling UNO at two cards is always legal */
      if (!called.ok) {
        throw new Error(`call-uno rejected: ${called.error.code}`);
      }
      current = called.state;
      events.push(...called.events);
    }

    const move = pickMove(current);
    /* c8 ignore next 3 -- pickMove always returns a move for an active game */
    if (move === null) {
      throw new Error('no legal move found');
    }
    const result = applyAction(current, move, ctx);
    if (!result.ok) {
      throw new Error(`auto move ${move.type} rejected: ${result.error.code}`);
    }
    current = result.state;
    events.push(...result.events);
  }

  /* c8 ignore next -- the turn guard is a safety net, not an expected path */
  throw new Error(`round did not finish within ${String(maxTurns)} turns`);
}

export const seededCtx = (seed: number): EngineContext => ({ rng: createRng(seed) });
