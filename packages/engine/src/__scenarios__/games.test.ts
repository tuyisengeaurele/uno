import { describe, expect, it } from 'vitest';

import { type Card } from '../cards.js';
import { defaultHouseRules } from '../config.js';
import { createRng } from '../rng.js';
import { applyAction } from '../reducer.js';
import { startNextRound, startRound, type PlayerSeat } from '../setup.js';
import { card, game, hand } from '../__support__/factory.js';
import { autoPlayRound, run, seededCtx } from './harness.js';

const seats = (n: number): PlayerSeat[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${String(i)}`, name: `Player ${String(i)}` }));

const totalCards = (players: { hand: Card[] }[], draw: Card[], discard: Card[]): number =>
  players.reduce((sum, p) => sum + p.hand.length, 0) + draw.length + discard.length;

describe('a full round', () => {
  it('runs from the deal to a winner with every card accounted for', () => {
    for (const seed of [1, 7, 42, 99, 256]) {
      const { state, events } = autoPlayRound(
        startRound(seats(3), defaultHouseRules(), createRng(seed)).state,
        createRng(seed + 1000),
      );

      expect(state.status).toBe('round-over');
      expect(state.roundWinnerId).not.toBeNull();
      expect(state.players.find((p) => p.id === state.roundWinnerId)?.hand).toHaveLength(0);
      expect(totalCards(state.players, state.drawPile, state.discardPile)).toBe(108);
      expect(events.at(-1)).toMatchObject({ type: 'round-ended' });
    }
  });

  it('finishes a four-player round that uses reverse and skip', () => {
    const { events, state } = autoPlayRound(
      startRound(seats(4), defaultHouseRules(), createRng(2024)).state,
      createRng(4048),
    );
    expect(state.status).toBe('round-over');
    // Over a full four-player round the deck almost always yields both.
    expect(events.some((e) => e.type === 'direction-reversed')).toBe(true);
    expect(events.some((e) => e.type === 'turn-skipped')).toBe(true);
  });
});

describe('scripted edge cases', () => {
  it('resolves a three-deep draw-two stack into a six-card draw', () => {
    const p0 = [card('red-draw-two'), card('green-draw-two'), card('blue-0')];
    const p1 = [card('blue-draw-two'), card('yellow-0')];
    const drawPile = Array.from({ length: 10 }, (_, i) => card(`yellow-${String(i % 10)}`));
    const start = game({
      hands: [p0, p1],
      top: card('red-9'),
      config: { stacking: 'draw-two' },
      drawPile,
    });

    const { state } = run(
      start,
      [
        { type: 'play-card', playerId: 'p0', cardId: p0[0]!.id },
        { type: 'play-card', playerId: 'p1', cardId: p1[0]!.id },
        { type: 'play-card', playerId: 'p0', cardId: p0[1]!.id },
        { type: 'draw', playerId: 'p1' },
      ],
      seededCtx(1),
    );

    expect(state.players[1]?.hand).toHaveLength(1 + 6);
    expect(state.pendingDraw).toBe(0);
    expect(state.currentPlayerIndex).toBe(0);
    expect(totalCards(state.players, state.drawPile, state.discardPile)).toBe(
      p0.length + p1.length + drawPile.length + 1,
    );
  });

  it('reshuffles the discard pile when the draw pile empties mid-round', () => {
    const base = game({ hands: [hand('red-0'), hand('blue-0')], top: card('green-5') });
    // Two cards to draw, and four more under the top of the discard pile to
    // reshuffle once the draw pile is gone. Neither yellow card is playable on
    // green, so each draw just passes the turn along.
    const start = {
      ...base,
      drawPile: [card('yellow-1'), card('yellow-7')],
      discardPile: [...hand('green-1', 'green-2', 'green-3', 'green-4'), card('green-5')],
    };

    const { state, events } = run(
      start,
      [
        { type: 'draw', playerId: 'p0' },
        { type: 'draw', playerId: 'p1' },
        { type: 'draw', playerId: 'p0' },
      ],
      seededCtx(3),
    );

    expect(totalCards(state.players, state.drawPile, state.discardPile)).toBe(2 + 2 + 5);
    expect(events).toContainEqual({
      type: 'player-drew',
      playerId: 'p0',
      count: 1,
      reshuffled: true,
    });
  });

  it('keeps reverse acting as skip across several two-player turns', () => {
    const start = game({
      hands: [hand('red-reverse', 'red-1', 'red-2'), hand('blue-reverse', 'blue-1', 'blue-2')],
      top: card('red-9'),
    });

    const afterFirst = run(
      start,
      [{ type: 'play-card', playerId: 'p0', cardId: start.players[0]!.hand[0]!.id }],
      seededCtx(1),
    );
    expect(afterFirst.state.currentPlayerIndex).toBe(0);

    const afterSecond = run(
      afterFirst.state,
      [{ type: 'play-card', playerId: 'p0', cardId: start.players[0]!.hand[1]!.id }],
      seededCtx(1),
    );
    expect(afterSecond.state.currentPlayerIndex).toBe(1);
  });

  it('penalises a player caught without calling UNO', () => {
    const red5 = card('red-5');
    const start = game({
      hands: [[red5, card('red-1')], hand('green-3')],
      top: card('red-9'),
      drawPile: hand('blue-1', 'blue-2', 'blue-3'),
    });

    const { state } = run(
      start,
      [
        { type: 'play-card', playerId: 'p0', cardId: red5.id },
        { type: 'catch-unfair-uno', accuserId: 'p1', targetId: 'p0' },
      ],
      seededCtx(1),
    );

    expect(state.players[0]?.hand).toHaveLength(1 + 2);
    expect(state.unoWindow).toBeNull();
  });
});

describe('a full match', () => {
  it('plays rounds until someone reaches the target score', () => {
    const config = defaultHouseRules({ targetScore: 100 });
    let setup = startRound(seats(3), config, createRng(11));
    let rounds = 0;

    while (setup.state.status !== 'match-over' && rounds < 40) {
      const finished = autoPlayRound(setup.state, createRng(500 + rounds));
      rounds += 1;
      if (finished.state.status === 'match-over') {
        expect(Math.max(...Object.values(finished.state.scores))).toBeGreaterThanOrEqual(100);
        return;
      }
      expect(finished.state.status).toBe('round-over');
      setup = startNextRound(finished.state, createRng(900 + rounds));
    }

    throw new Error('match did not reach the target score');
  });
});

describe('finished rounds reject further moves', () => {
  it('returns game-not-active once the round is over', () => {
    const red5 = card('red-5');
    const start = game({ hands: [[red5], hand('green-3')], top: card('red-9') });
    const { state } = run(
      start,
      [{ type: 'play-card', playerId: 'p0', cardId: red5.id }],
      seededCtx(1),
    );

    const result = applyAction(state, { type: 'draw', playerId: 'p1' }, seededCtx(1));
    expect(result.ok || result.error.code).toBe('game-not-active');
  });
});
