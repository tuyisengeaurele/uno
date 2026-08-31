import { describe, expect, it } from 'vitest';

import { type Card } from './cards.js';
import { defaultHouseRules, type HouseRules } from './config.js';
import { createRng } from './rng.js';
import { startRound, type PlayerSeat, type RoundSetup } from './setup.js';

const seats = (count: number): PlayerSeat[] =>
  Array.from({ length: count }, (_, i) => ({ id: `p${String(i)}`, name: `Player ${String(i)}` }));

const cardCount = (setup: RoundSetup): number => {
  const { players, drawPile, discardPile } = setup.state;
  return players.reduce((sum, p) => sum + p.hand.length, 0) + drawPile.length + discardPile.length;
};

/** Search seeds for a round whose flipped starting card matches `predicate`. */
const roundWhere = (
  predicate: (card: Card) => boolean,
  config: HouseRules = defaultHouseRules(),
): RoundSetup => {
  for (let seed = 0; seed < 10_000; seed += 1) {
    const setup = startRound(seats(2), config, createRng(seed));
    const top = setup.state.discardPile[0];
    if (top !== undefined && predicate(top)) {
      return setup;
    }
  }
  throw new Error('no seed produced a matching starting card');
};

describe('startRound player count', () => {
  it('accepts 2 through 10 players', () => {
    for (let n = 2; n <= 10; n += 1) {
      expect(() => startRound(seats(n), defaultHouseRules(), createRng(n))).not.toThrow();
    }
  });

  it('rejects fewer than 2 or more than 10', () => {
    expect(() => startRound(seats(1), defaultHouseRules(), createRng(1))).toThrow(RangeError);
    expect(() => startRound(seats(11), defaultHouseRules(), createRng(1))).toThrow(RangeError);
  });
});

describe('startRound dealing', () => {
  it('deals seven cards to every player and conserves the deck', () => {
    const setup = startRound(seats(5), defaultHouseRules(), createRng(3));
    expect(setup.state.players.every((p) => p.hand.length === 7)).toBe(true);
    expect(cardCount(setup)).toBe(108);
  });

  it('starts every score at zero and carries forward the ones it is given', () => {
    const fresh = startRound(seats(3), defaultHouseRules(), createRng(1));
    expect(fresh.state.scores).toEqual({ p0: 0, p1: 0, p2: 0 });

    const carried = startRound(seats(3), defaultHouseRules(), createRng(1), {
      scores: { p0: 120, p1: 0, p2: 55 },
    });
    expect(carried.state.scores).toEqual({ p0: 120, p1: 0, p2: 55 });
  });
});

describe('official first-card rules', () => {
  it('a number card just sets the active colour', () => {
    const setup = roundWhere((c) => c.kind === 'number');
    const top = setup.state.discardPile[0];
    expect(top?.kind).toBe('number');
    expect(setup.state.activeColor).toBe(top && 'color' in top ? top.color : undefined);
    expect(setup.state.currentPlayerIndex).toBe(0);
    expect(setup.events).toHaveLength(0);
  });

  it('a wild card leaves the first player owing a colour choice', () => {
    const setup = roundWhere((c) => c.kind === 'wild');
    expect(setup.state.activeColor).toBeNull();
    expect(setup.state.pendingColorChoice).toBe('p0');
    expect(setup.state.currentPlayerIndex).toBe(0);
  });

  it('never flips a wild draw four to start', () => {
    for (let seed = 0; seed < 400; seed += 1) {
      const setup = startRound(seats(4), defaultHouseRules(), createRng(seed));
      expect(setup.state.discardPile[0]?.kind).not.toBe('wild-draw-four');
    }
  });

  it('a skip card skips the first player', () => {
    const setup = roundWhere((c) => c.kind === 'skip');
    expect(setup.state.currentPlayerIndex).toBe(1);
    expect(setup.events).toContainEqual({ type: 'turn-skipped', playerId: 'p0' });
    expect(cardCount(setup)).toBe(108);
  });

  it('a reverse card flips the direction', () => {
    const setup = roundWhere((c) => c.kind === 'reverse');
    expect(setup.state.direction).toBe(-1);
    expect(setup.events).toContainEqual({ type: 'direction-reversed', direction: -1 });
  });

  it('a draw two card makes the first player draw two and lose the turn', () => {
    const setup = roundWhere((c) => c.kind === 'draw-two');
    expect(setup.state.players[0]?.hand).toHaveLength(9);
    expect(setup.state.currentPlayerIndex).toBe(1);
    expect(setup.events).toContainEqual({
      type: 'player-drew',
      playerId: 'p0',
      count: 2,
      reshuffled: false,
    });
    expect(setup.events).toContainEqual({ type: 'turn-skipped', playerId: 'p0' });
    expect(cardCount(setup)).toBe(108);
  });
});

describe('simple first-card rule', () => {
  it('always starts on a number card', () => {
    const config = defaultHouseRules({ firstCardRule: 'simple' });
    for (let seed = 0; seed < 400; seed += 1) {
      const setup = startRound(seats(3), config, createRng(seed));
      expect(setup.state.discardPile[0]?.kind).toBe('number');
    }
  });
});
