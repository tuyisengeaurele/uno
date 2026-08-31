import { describe, expect, it } from 'vitest';

import { createRng } from './rng.js';
import { applyAction } from './reducer.js';
import { startNextRound } from './setup.js';
import { handValue, tallyRound } from './scoring.js';
import { card, game, hand } from './__support__/factory.js';

describe('handValue', () => {
  it('adds up numbers, action cards, and wilds', () => {
    expect(handValue(hand('red-7', 'blue-3'))).toBe(10);
    expect(handValue([card('red-skip'), card('green-draw-two')])).toBe(40);
    expect(handValue([card('wild'), card('wild-draw-four')])).toBe(100);
  });
});

describe('tallyRound', () => {
  it('gives the winner the sum of every other hand', () => {
    const players = [
      { id: 'a', name: 'A', hand: [], hasCalledUno: false },
      { id: 'b', name: 'B', hand: hand('red-9', 'blue-5'), hasCalledUno: false },
      { id: 'c', name: 'C', hand: [card('wild')], hasCalledUno: false },
    ];
    const tally = tallyRound(players, 'a', { a: 10, b: 0, c: 0 });
    expect(tally.scores).toEqual({ a: 10 + 14 + 50, b: 0, c: 0 });
    expect(tally.winnerTotal).toBe(74);
  });

  it('treats a winner with no prior score as starting from zero', () => {
    const players = [
      { id: 'a', name: 'A', hand: [], hasCalledUno: false },
      { id: 'b', name: 'B', hand: hand('red-4'), hasCalledUno: false },
    ];
    const tally = tallyRound(players, 'a', { b: 0 });
    expect(tally.scores).toEqual({ a: 4, b: 0 });
    expect(tally.winnerTotal).toBe(4);
  });
});

describe('scoring a round through the reducer', () => {
  it('adds the opponents hand value to the winner and ends the round', () => {
    const red5 = card('red-5');
    const state = game({
      hands: [[red5], hand('blue-9', 'green-2')],
      top: card('red-9'),
      scores: { p0: 40, p1: 120 },
    });
    const result = applyAction(
      state,
      { type: 'play-card', playerId: 'p0', cardId: red5.id },
      {
        rng: createRng(1),
      },
    );
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.state.status).toBe('round-over');
    expect(result.state.scores).toEqual({ p0: 40 + 11, p1: 120 });
    expect(result.events).toContainEqual({
      type: 'round-ended',
      winnerId: 'p0',
      scores: { p0: 51, p1: 120 },
    });
  });

  it('ends the match when the winner passes the target score', () => {
    const red5 = card('red-5');
    const state = game({
      hands: [[red5], hand('wild-draw-four')],
      top: card('red-9'),
      scores: { p0: 470, p1: 0 },
      config: { targetScore: 500 },
    });
    const result = applyAction(
      state,
      { type: 'play-card', playerId: 'p0', cardId: red5.id },
      {
        rng: createRng(1),
      },
    );
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.state.status).toBe('match-over');
    expect(result.state.scores['p0']).toBe(520);
    expect(result.events).toContainEqual({
      type: 'match-ended',
      winnerId: 'p0',
      scores: { p0: 520, p1: 0 },
    });
  });
});

describe('startNextRound', () => {
  it('keeps the scores and moves the starting seat along', () => {
    const ended = game({
      hands: [hand('red-1'), hand('blue-2'), hand('green-3')],
      top: card('red-9'),
      scores: { p0: 100, p1: 30, p2: 210 },
    });
    const next = startNextRound({ ...ended, startingPlayerIndex: 0 }, createRng(9));

    expect(next.state.scores).toEqual({ p0: 100, p1: 30, p2: 210 });
    expect(next.state.startingPlayerIndex).toBe(1);
    expect(next.state.players.every((p) => p.hand.length === 7)).toBe(true);
  });
});
