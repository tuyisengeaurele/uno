import { describe, expect, it } from 'vitest';

import { createRng } from './rng.js';
import { applyAction, type ActionResult } from './reducer.js';
import { card, game, hand } from './__support__/factory.js';

const ctx = { rng: createRng(1) };

const expectOk = (result: ActionResult): Extract<ActionResult, { ok: true }> => {
  if (!result.ok) {
    throw new Error(`expected ok, got error ${result.error.code}`);
  }
  return result;
};

describe('play-card validation', () => {
  it('rejects a play out of turn', () => {
    const state = game({ hands: [hand('red-5'), hand('red-3')], top: card('red-9') });
    const result = applyAction(
      state,
      { type: 'play-card', playerId: 'p1', cardId: state.players[1]!.hand[0]!.id },
      ctx,
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'not-your-turn', message: expect.any(String) },
    });
  });

  it('rejects a card the player does not hold', () => {
    const state = game({ hands: [hand('red-5'), hand('red-3')], top: card('red-9') });
    const result = applyAction(state, { type: 'play-card', playerId: 'p0', cardId: 'ghost' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.ok || result.error.code).toBe('card-not-in-hand');
  });

  it('rejects a card that matches neither colour, value, nor kind', () => {
    const blue2 = card('blue-2');
    const state = game({ hands: [[blue2], hand('red-3')], top: card('red-9') });
    const result = applyAction(state, { type: 'play-card', playerId: 'p0', cardId: blue2.id }, ctx);
    expect(result.ok || result.error.code).toBe('illegal-play');
  });

  it('rejects a wild played without a colour', () => {
    const wild = card('wild');
    const state = game({ hands: [[wild], hand('red-3')], top: card('red-9') });
    const result = applyAction(state, { type: 'play-card', playerId: 'p0', cardId: wild.id }, ctx);
    expect(result.ok || result.error.code).toBe('color-required');
  });

  it('rejects a colour on a non-wild card', () => {
    const red5 = card('red-5');
    const state = game({ hands: [[red5], hand('red-3')], top: card('red-9') });
    const result = applyAction(
      state,
      { type: 'play-card', playerId: 'p0', cardId: red5.id, chosenColor: 'blue' },
      ctx,
    );
    expect(result.ok || result.error.code).toBe('color-not-expected');
  });
});

describe('play-card effects', () => {
  it('moves a number card to the pile and advances the turn', () => {
    const red5 = card('red-5');
    const state = game({ hands: [[red5, card('blue-1')], hand('green-3')], top: card('red-9') });
    const { state: next, events } = expectOk(
      applyAction(state, { type: 'play-card', playerId: 'p0', cardId: red5.id }, ctx),
    );

    expect(next.discardPile.at(-1)).toBe(red5);
    expect(next.activeColor).toBe('red');
    expect(next.players[0]?.hand).toHaveLength(1);
    expect(next.currentPlayerIndex).toBe(1);
    expect(events).toContainEqual({ type: 'card-played', playerId: 'p0', card: red5 });
  });

  it('sets the active colour from a wild and reports the choice', () => {
    const wild = card('wild');
    const state = game({ hands: [[wild, card('red-1')], hand('green-3')], top: card('red-9') });
    const { state: next, events } = expectOk(
      applyAction(
        state,
        { type: 'play-card', playerId: 'p0', cardId: wild.id, chosenColor: 'blue' },
        ctx,
      ),
    );

    expect(next.activeColor).toBe('blue');
    expect(events).toEqual([
      { type: 'card-played', playerId: 'p0', card: wild },
      { type: 'color-chosen', playerId: 'p0', color: 'blue' },
    ]);
  });

  it('skips the next player on a skip card', () => {
    const skip = card('red-skip');
    const state = game({
      hands: [[skip, card('red-1')], hand('green-3'), hand('blue-4')],
      top: card('red-9'),
    });
    const { state: next, events } = expectOk(
      applyAction(state, { type: 'play-card', playerId: 'p0', cardId: skip.id }, ctx),
    );

    expect(next.currentPlayerIndex).toBe(2);
    expect(events).toContainEqual({ type: 'turn-skipped', playerId: 'p1' });
  });

  it('reverses direction with three or more players', () => {
    const rev = card('red-reverse');
    const state = game({
      hands: [[rev, card('red-1')], hand('green-3'), hand('blue-4')],
      top: card('red-9'),
    });
    const { state: next, events } = expectOk(
      applyAction(state, { type: 'play-card', playerId: 'p0', cardId: rev.id }, ctx),
    );

    expect(next.direction).toBe(-1);
    expect(next.currentPlayerIndex).toBe(2);
    expect(events).toContainEqual({ type: 'direction-reversed', direction: -1 });
  });

  it('treats reverse as skip in a two-player game', () => {
    const rev = card('red-reverse');
    const state = game({ hands: [[rev, card('red-1')], hand('green-3')], top: card('red-9') });
    const { state: next } = expectOk(
      applyAction(state, { type: 'play-card', playerId: 'p0', cardId: rev.id }, ctx),
    );

    expect(next.currentPlayerIndex).toBe(0);
  });

  it('ends the round when the last card is played', () => {
    const red5 = card('red-5');
    const state = game({ hands: [[red5], hand('green-3')], top: card('red-9') });
    const { state: next, events } = expectOk(
      applyAction(state, { type: 'play-card', playerId: 'p0', cardId: red5.id }, ctx),
    );

    expect(next.status).toBe('round-over');
    expect(next.roundWinnerId).toBe('p0');
    expect(events).toContainEqual({ type: 'round-ended', winnerId: 'p0', scores: next.scores });
  });

  it('opens the UNO window when a player reaches one card without calling', () => {
    const red5 = card('red-5');
    const state = game({ hands: [[red5, card('blue-1')], hand('green-3')], top: card('red-9') });
    const { state: next } = expectOk(
      applyAction(state, { type: 'play-card', playerId: 'p0', cardId: red5.id }, ctx),
    );

    expect(next.unoWindow).toEqual({ playerId: 'p0' });
  });

  it('does not open the UNO window when the player called ahead of time', () => {
    const red5 = card('red-5');
    const state = game({
      hands: [[red5, card('blue-1')], hand('green-3')],
      top: card('red-9'),
      hasCalledUno: { p0: true },
    });
    const { state: next } = expectOk(
      applyAction(state, { type: 'play-card', playerId: 'p0', cardId: red5.id }, ctx),
    );

    expect(next.unoWindow).toBeNull();
  });
});

describe('choose-color', () => {
  it('resolves a pending first-card colour choice', () => {
    const state = game({
      hands: [hand('red-5'), hand('green-3')],
      top: card('wild'),
      pendingColorChoice: 'p0',
    });
    const { state: next, events } = expectOk(
      applyAction(state, { type: 'choose-color', playerId: 'p0', color: 'green' }, ctx),
    );

    expect(next.activeColor).toBe('green');
    expect(next.pendingColorChoice).toBeNull();
    expect(events).toEqual([{ type: 'color-chosen', playerId: 'p0', color: 'green' }]);
  });

  it('rejects a colour choice from the wrong player', () => {
    const state = game({
      hands: [hand('red-5'), hand('green-3')],
      top: card('wild'),
      pendingColorChoice: 'p0',
    });
    const result = applyAction(
      state,
      { type: 'choose-color', playerId: 'p1', color: 'green' },
      ctx,
    );
    expect(result.ok || result.error.code).toBe('not-your-turn');
  });

  it('rejects a colour choice when none is pending', () => {
    const state = game({ hands: [hand('red-5'), hand('green-3')], top: card('red-9') });
    const result = applyAction(
      state,
      { type: 'choose-color', playerId: 'p0', color: 'green' },
      ctx,
    );
    expect(result.ok || result.error.code).toBe('color-not-expected');
  });

  it('blocks a play while a colour choice is owed', () => {
    const red5 = card('red-5');
    const state = game({
      hands: [[red5], hand('green-3')],
      top: card('wild'),
      pendingColorChoice: 'p0',
    });
    const result = applyAction(state, { type: 'play-card', playerId: 'p0', cardId: red5.id }, ctx);
    expect(result.ok || result.error.code).toBe('resolve-color-choice');
  });
});
