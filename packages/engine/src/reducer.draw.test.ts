import { describe, expect, it } from 'vitest';

import { createRng } from './rng.js';
import { applyAction, type ActionResult } from './reducer.js';
import { card, game, hand } from './__support__/factory.js';

const ctx = { rng: createRng(7) };

const ok = (result: ActionResult): Extract<ActionResult, { ok: true }> => {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}`);
  }
  return result;
};

describe('draw on your turn', () => {
  it('rejects a draw out of turn', () => {
    const state = game({ hands: [hand('red-1'), hand('blue-2')], top: card('green-9') });
    const result = applyAction(state, { type: 'draw', playerId: 'p1' }, ctx);
    expect(result.ok || result.error.code).toBe('not-your-turn');
  });

  it('takes exactly one card and passes the turn when it is not playable', () => {
    const state = game({
      hands: [hand('red-1'), hand('blue-2')],
      top: card('green-9'),
      drawPile: [card('blue-4'), card('yellow-7')],
    });
    const { state: next, events } = ok(applyAction(state, { type: 'draw', playerId: 'p0' }, ctx));

    expect(next.players[0]?.hand).toHaveLength(2);
    expect(next.drawnCard).toBeNull();
    expect(next.currentPlayerIndex).toBe(1);
    expect(events).toEqual([{ type: 'player-drew', playerId: 'p0', count: 1, reshuffled: false }]);
  });

  it('lets the player hold the drawn card when it is playable', () => {
    const green3 = card('green-3');
    const state = game({
      hands: [hand('red-1'), hand('blue-2')],
      top: card('green-9'),
      drawPile: [green3, card('yellow-7')],
    });
    const { state: next } = ok(applyAction(state, { type: 'draw', playerId: 'p0' }, ctx));

    expect(next.drawnCard).toEqual({ playerId: 'p0', cardId: green3.id, playable: true });
    expect(next.currentPlayerIndex).toBe(0);
  });

  it('rejects a second draw in the same turn', () => {
    const state = game({
      hands: [hand('red-1'), hand('blue-2')],
      top: card('green-9'),
      drawnCard: { playerId: 'p0', cardId: 'x', playable: false },
    });
    const result = applyAction(state, { type: 'draw', playerId: 'p0' }, ctx);
    expect(result.ok || result.error.code).toBe('draw-first');
  });

  it('draws until a playable card turns up when the house rule is on', () => {
    const state = game({
      hands: [hand('red-1'), hand('blue-2')],
      top: card('green-9'),
      config: { drawUntilPlayable: true },
      drawPile: [card('red-4'), card('yellow-7'), card('green-2'), card('blue-8')],
    });
    const { state: next } = ok(applyAction(state, { type: 'draw', playerId: 'p0' }, ctx));

    // red-4, yellow-7, then green-2 which matches the green pile
    expect(next.players[0]?.hand).toHaveLength(4);
    expect(next.drawnCard?.cardId).toBe(next.players[0]?.hand.at(-1)?.id);
  });
});

describe('play-drawn and pass', () => {
  it('plays the card that was just drawn', () => {
    const green3 = card('green-3');
    const state = game({
      hands: [[...hand('red-1'), green3], hand('blue-2')],
      top: card('green-9'),
      drawnCard: { playerId: 'p0', cardId: green3.id, playable: true },
    });
    const { state: next } = ok(
      applyAction(state, { type: 'play-drawn', playerId: 'p0', cardId: green3.id }, ctx),
    );

    expect(next.discardPile.at(-1)).toBe(green3);
    expect(next.currentPlayerIndex).toBe(1);
    expect(next.drawnCard).toBeNull();
  });

  it('rejects playing a card other than the one just drawn', () => {
    const green3 = card('green-3');
    const red1 = card('red-1');
    const state = game({
      hands: [[red1, green3], hand('blue-2')],
      top: card('green-9'),
      drawnCard: { playerId: 'p0', cardId: green3.id, playable: true },
    });
    const result = applyAction(state, { type: 'play-drawn', playerId: 'p0', cardId: red1.id }, ctx);
    expect(result.ok || result.error.code).toBe('card-not-drawn');
  });

  it('passes after drawing', () => {
    const state = game({
      hands: [hand('red-1', 'green-3'), hand('blue-2')],
      top: card('green-9'),
      drawnCard: { playerId: 'p0', cardId: 'green-3', playable: false },
    });
    const { state: next } = ok(applyAction(state, { type: 'pass', playerId: 'p0' }, ctx));
    expect(next.currentPlayerIndex).toBe(1);
    expect(next.drawnCard).toBeNull();
  });

  it('rejects a pass when the player has not drawn', () => {
    const state = game({ hands: [hand('red-1'), hand('blue-2')], top: card('green-9') });
    const result = applyAction(state, { type: 'pass', playerId: 'p0' }, ctx);
    expect(result.ok || result.error.code).toBe('nothing-to-pass');
  });

  it('rejects a pass out of turn', () => {
    const state = game({ hands: [hand('red-1'), hand('blue-2')], top: card('green-9') });
    const result = applyAction(state, { type: 'pass', playerId: 'p1' }, ctx);
    expect(result.ok || result.error.code).toBe('not-your-turn');
  });

  it('rejects play-drawn when nothing was drawn', () => {
    const red1 = card('red-1');
    const state = game({ hands: [[red1], hand('blue-2')], top: card('red-9') });
    const result = applyAction(state, { type: 'play-drawn', playerId: 'p0', cardId: red1.id }, ctx);
    expect(result.ok || result.error.code).toBe('card-not-drawn');
  });

  it('rejects a draw while a first-card colour choice is owed', () => {
    const state = game({
      hands: [hand('red-1'), hand('blue-2')],
      top: card('wild'),
      pendingColorChoice: 'p0',
    });
    const result = applyAction(state, { type: 'draw', playerId: 'p0' }, ctx);
    expect(result.ok || result.error.code).toBe('resolve-color-choice');
  });

  it('blocks a normal play while a drawn card is unresolved', () => {
    const red1 = card('red-1');
    const state = game({
      hands: [[red1], hand('blue-2')],
      top: card('red-9'),
      drawnCard: { playerId: 'p0', cardId: 'other', playable: false },
    });
    const result = applyAction(state, { type: 'play-card', playerId: 'p0', cardId: red1.id }, ctx);
    expect(result.ok || result.error.code).toBe('must-answer-draw');
  });
});
