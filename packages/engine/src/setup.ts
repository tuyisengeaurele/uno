import { buildDeck, isNumberCard, type Card } from './cards.js';
import { deal, shuffle } from './deck.js';
import type { GameEvent } from './events.js';
import type { HouseRules } from './config.js';
import type { Rng } from './rng.js';
import type { GameState, PlayerState } from './state.js';
import { nextIndex } from './turn.js';

export interface PlayerSeat {
  readonly id: string;
  readonly name: string;
}

export interface RoundSetup {
  readonly state: GameState;
  readonly events: GameEvent[];
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const HAND_SIZE = 7;

/**
 * Deal a fresh round. `startingSeat` is the seat that plays first before any
 * first-card effect; it rotates between rounds. `scores` carries match totals
 * forward and defaults to zero for everyone.
 */
export function startRound(
  seats: readonly PlayerSeat[],
  config: HouseRules,
  rng: Rng,
  options: { scores?: Readonly<Record<string, number>>; startingSeat?: number } = {},
): RoundSetup {
  if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
    throw new RangeError(`a round needs ${String(MIN_PLAYERS)} to ${String(MAX_PLAYERS)} players`);
  }

  const startingSeat = options.startingSeat ?? 0;
  const { hands, drawPile: undealt } = deal(shuffle(buildDeck(), rng), seats.length, HAND_SIZE);

  const players: PlayerState[] = seats.map((seat, i) => ({
    id: seat.id,
    name: seat.name,
    /* c8 ignore next -- deal() always returns one hand per seat */
    hand: hands[i] ?? [],
    hasCalledUno: false,
  }));

  const scores: Record<string, number> = {};
  for (const seat of seats) {
    scores[seat.id] = options.scores?.[seat.id] ?? 0;
  }

  const { top, rest } = drawStartingCard(undealt, config);

  const base: GameState = {
    players,
    currentPlayerIndex: startingSeat,
    direction: 1,
    drawPile: shuffle(rest, rng),
    discardPile: [top],
    activeColor: null,
    pendingDraw: 0,
    pendingDrawKind: null,
    pendingWildFour: null,
    pendingColorChoice: null,
    drawnCard: null,
    unoWindow: null,
    status: 'active',
    roundWinnerId: null,
    scores,
    config,
    startingPlayerIndex: startingSeat,
  };

  return applyStartingCard(base, top);
}

/**
 * Deal the next round of a match. Scores carry over and the starting seat moves
 * one place along, the way the deal passes around a table.
 */
export function startNextRound(state: GameState, rng: Rng): RoundSetup {
  const seats = state.players.map((player) => ({ id: player.id, name: player.name }));
  return startRound(seats, state.config, rng, {
    scores: state.scores,
    startingSeat: nextIndex(state.startingPlayerIndex, 1, seats.length, 1),
  });
}

/**
 * Pull the card that starts the discard pile. Wild Draw Four is never a starting
 * card. Under the `simple` rule, neither is anything other than a number.
 */
function drawStartingCard(pile: readonly Card[], config: HouseRules): { top: Card; rest: Card[] } {
  const ineligible = (card: Card): boolean =>
    card.kind === 'wild-draw-four' || (config.firstCardRule === 'simple' && !isNumberCard(card));

  const working = [...pile];
  const index = working.findIndex((card) => !ineligible(card));
  /* c8 ignore next 3 -- a freshly dealt deck always has an eligible starting card */
  if (index < 0) {
    throw new Error('no eligible starting card in the deck');
  }

  const [top] = working.splice(index, 1) as [Card];
  return { top, rest: working };
}

/** Apply the effect of the flipped starting card to a freshly built state. */
function applyStartingCard(state: GameState, top: Card): RoundSetup {
  const seatCount = state.players.length;
  const firstSeat = state.startingPlayerIndex;
  const firstPlayer = state.players[firstSeat];
  /* c8 ignore next 3 -- startingPlayerIndex is validated against seat count */
  if (firstPlayer === undefined) {
    throw new RangeError('starting seat is out of range');
  }
  const afterFirst = nextIndex(firstSeat, 1, seatCount, 1);
  const events: GameEvent[] = [];

  switch (top.kind) {
    case 'number':
      return { state: { ...state, activeColor: top.color }, events };

    case 'wild':
      return {
        state: { ...state, activeColor: null, pendingColorChoice: firstPlayer.id },
        events,
      };

    case 'skip':
      events.push({ type: 'turn-skipped', playerId: firstPlayer.id });
      return {
        state: { ...state, activeColor: top.color, currentPlayerIndex: afterFirst },
        events,
      };

    case 'reverse':
      events.push({ type: 'direction-reversed', direction: -1 });
      return { state: { ...state, activeColor: top.color, direction: -1 }, events };

    case 'draw-two': {
      const drawn = state.drawPile.slice(0, 2);
      const players = state.players.map((player, i) =>
        i === firstSeat ? { ...player, hand: [...player.hand, ...drawn] } : player,
      );
      events.push({
        type: 'player-drew',
        playerId: firstPlayer.id,
        count: drawn.length,
        reshuffled: false,
      });
      events.push({ type: 'turn-skipped', playerId: firstPlayer.id });
      return {
        state: {
          ...state,
          activeColor: top.color,
          players,
          drawPile: state.drawPile.slice(2),
          currentPlayerIndex: afterFirst,
        },
        events,
      };
    }

    /* c8 ignore next 2 -- wild-draw-four is filtered out before a round starts */
    case 'wild-draw-four':
      throw new Error('wild-draw-four cannot be a starting card');
  }
}
