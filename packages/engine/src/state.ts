import type { Card, CardColor } from './cards.js';
import type { HouseRules } from './config.js';

export interface PlayerState {
  readonly id: string;
  readonly name: string;
  readonly hand: Card[];
  /** A standing UNO call. Set when the player calls it, cleared when they draw. */
  readonly hasCalledUno: boolean;
}

export type GameStatus = 'active' | 'round-over' | 'match-over';

export type PendingDrawKind = 'draw-two' | 'draw-four';

/**
 * Recorded when a Wild Draw Four is played so a challenge can be resolved without
 * guessing. `hadColorMatch` is whether the player was holding a card of
 * `colorBefore` at the moment they played it.
 */
export interface PendingWildFour {
  readonly playedBy: string;
  readonly colorBefore: CardColor;
  readonly hadColorMatch: boolean;
}

/** A card a player has drawn this turn and may still play or keep. */
export interface DrawnCard {
  readonly playerId: string;
  readonly cardId: string;
  readonly playable: boolean;
}

export interface GameState {
  readonly players: PlayerState[];
  readonly currentPlayerIndex: number;
  readonly direction: 1 | -1;
  readonly drawPile: Card[];
  readonly discardPile: Card[];
  /** The colour in play. Null only in the brief moment before the first card. */
  readonly activeColor: CardColor | null;
  /** Cards the current player must draw or stack. Zero when nothing is pending. */
  readonly pendingDraw: number;
  readonly pendingDrawKind: PendingDrawKind | null;
  readonly pendingWildFour: PendingWildFour | null;
  /** Player who owes a colour choice (first card of the round was a wild). */
  readonly pendingColorChoice: string | null;
  readonly drawnCard: DrawnCard | null;
  /** The player who reached one card without calling UNO, still catchable. */
  readonly unoWindow: { readonly playerId: string } | null;
  readonly status: GameStatus;
  readonly roundWinnerId: string | null;
  readonly scores: Readonly<Record<string, number>>;
  readonly config: HouseRules;
  /** Seat that dealt this round. Rotates by one each round. */
  readonly startingPlayerIndex: number;
}

export function currentPlayer(state: GameState): PlayerState {
  const player = state.players[state.currentPlayerIndex];
  if (player === undefined) {
    throw new RangeError(`currentPlayerIndex ${String(state.currentPlayerIndex)} is out of range`);
  }
  return player;
}

export function playerById(state: GameState, id: string): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

export function topCard(state: GameState): Card | undefined {
  return state.discardPile.at(-1);
}
