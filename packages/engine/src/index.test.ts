import { describe, expect, it } from 'vitest';

import { applyAction, createRng, defaultHouseRules, startRound } from './index.js';

describe('public API', () => {
  it('runs a short game through the package entry point', () => {
    const rng = createRng(2024);
    const { state } = startRound(
      [
        { id: 'a', name: 'Ada' },
        { id: 'b', name: 'Béla' },
      ],
      defaultHouseRules(),
      rng,
    );

    const player = state.players[state.currentPlayerIndex];
    expect(player).toBeDefined();

    // Draw a card, which is always a legal move at the start of a turn.
    const result = applyAction(state, { type: 'draw', playerId: player!.id }, { rng });
    expect(result.ok).toBe(true);
  });
});
