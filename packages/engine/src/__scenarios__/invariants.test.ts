import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type Card } from '../cards.js';
import { defaultHouseRules, type HouseRules } from '../config.js';
import { createRng } from '../rng.js';
import { applyAction } from '../reducer.js';
import { startRound } from '../setup.js';
import type { GameState } from '../state.js';
import { legalMoves } from './harness.js';

const allCards = (state: GameState): Card[] => [
  ...state.players.flatMap((p) => p.hand),
  ...state.drawPile,
  ...state.discardPile,
];

function checkInvariants(state: GameState): void {
  const cards = allCards(state);

  expect(cards).toHaveLength(108);
  expect(new Set(cards.map((c) => c.id)).size).toBe(108);

  expect(state.currentPlayerIndex).toBeGreaterThanOrEqual(0);
  expect(state.currentPlayerIndex).toBeLessThan(state.players.length);
  expect([1, -1]).toContain(state.direction);

  expect(state.pendingDraw).toBeGreaterThanOrEqual(0);
  expect(state.pendingDraw === 0).toBe(state.pendingDrawKind === null);

  if (state.status === 'active') {
    expect(state.players.every((p) => p.hand.length > 0)).toBe(true);
  }
}

const houseRules = (): HouseRules =>
  defaultHouseRules({ stacking: 'both', targetScore: 200, drawUntilPlayable: false });

describe('state stays consistent under any legal sequence of moves', () => {
  it('holds across many random games', { timeout: 60_000 }, () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.integer({ min: 2, max: 10 }),
        (seed, playerCount) => {
          const rng = createRng(seed);
          const seats = Array.from({ length: playerCount }, (_, i) => ({
            id: `p${String(i)}`,
            name: `P${String(i)}`,
          }));

          let state = startRound(seats, houseRules(), rng).state;
          checkInvariants(state);

          for (let step = 0; step < 200 && state.status === 'active'; step += 1) {
            const moves = legalMoves(state);
            expect(moves.length).toBeGreaterThan(0);

            const move = moves[rng.int(moves.length)];
            expect(move).toBeDefined();

            const result = applyAction(state, move!, { rng });
            if (!result.ok) {
              throw new Error(`legal move ${move!.type} was rejected: ${result.error.code}`);
            }
            state = result.state;
            checkInvariants(state);
          }
        },
      ),
      { numRuns: 250 },
    );
  });
});
