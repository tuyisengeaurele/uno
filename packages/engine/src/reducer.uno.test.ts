import { describe, expect, it } from 'vitest';

import { createRng } from './rng.js';
import { applyAction, type ActionResult } from './reducer.js';
import { card, game, hand } from './__support__/factory.js';

const ctx = { rng: createRng(11) };

const ok = (result: ActionResult): Extract<ActionResult, { ok: true }> => {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}`);
  }
  return result;
};

describe('calling UNO', () => {
  it('pre-empts the penalty when called at two cards', () => {
    const red5 = card('red-5');
    const state = game({ hands: [[red5, card('blue-1')], hand('green-3')], top: card('red-9') });

    const called = ok(applyAction(state, { type: 'call-uno', playerId: 'p0' }, ctx));
    expect(called.state.players[0]?.hasCalledUno).toBe(true);

    const played = ok(
      applyAction(called.state, { type: 'play-card', playerId: 'p0', cardId: red5.id }, ctx),
    );
    expect(played.state.unoWindow).toBeNull();
  });

  it('rejects a call with more than two cards', () => {
    const state = game({
      hands: [hand('red-5', 'red-6', 'red-7'), hand('green-3')],
      top: card('red-9'),
    });
    const result = applyAction(state, { type: 'call-uno', playerId: 'p0' }, ctx);
    expect(result.ok || result.error.code).toBe('uno-not-available');
  });

  it('closes the window when the vulnerable player calls in time', () => {
    const state = game({
      hands: [hand('red-5'), hand('green-3')],
      top: card('red-9'),
      unoWindow: { playerId: 'p0' },
    });
    const called = ok(applyAction(state, { type: 'call-uno', playerId: 'p0' }, ctx));
    expect(called.state.unoWindow).toBeNull();
  });
});

describe('catching an unfair UNO', () => {
  it('makes the caught player draw the penalty and closes the window', () => {
    const state = game({
      hands: [hand('red-5'), hand('green-3')],
      top: card('red-9'),
      unoWindow: { playerId: 'p0' },
      drawPile: hand('blue-1', 'blue-2', 'blue-3'),
    });
    const caught = ok(
      applyAction(state, { type: 'catch-unfair-uno', accuserId: 'p1', targetId: 'p0' }, ctx),
    );

    expect(caught.state.players[0]?.hand).toHaveLength(3);
    expect(caught.state.unoWindow).toBeNull();
    expect(caught.events).toEqual([
      { type: 'uno-penalty', playerId: 'p0', accuserId: 'p1', count: 2 },
    ]);
  });

  it('honours a penalty of four when configured', () => {
    const state = game({
      hands: [hand('red-5'), hand('green-3')],
      top: card('red-9'),
      unoWindow: { playerId: 'p0' },
      config: { unoPenalty: 4 },
      drawPile: hand('blue-1', 'blue-2', 'blue-3', 'blue-4', 'blue-5'),
    });
    const caught = ok(
      applyAction(state, { type: 'catch-unfair-uno', accuserId: 'p1', targetId: 'p0' }, ctx),
    );
    expect(caught.state.players[0]?.hand).toHaveLength(5);
  });

  it('rejects a catch once the window has closed', () => {
    const state = game({ hands: [hand('red-5'), hand('green-3')], top: card('red-9') });
    const result = applyAction(
      state,
      { type: 'catch-unfair-uno', accuserId: 'p1', targetId: 'p0' },
      ctx,
    );
    expect(result.ok || result.error.code).toBe('no-uno-to-catch');
  });

  it('rejects a catch against a player who is not at one card', () => {
    const state = game({
      hands: [hand('red-5', 'red-6'), hand('green-3')],
      top: card('red-9'),
      unoWindow: { playerId: 'p0' },
    });
    const result = applyAction(
      state,
      { type: 'catch-unfair-uno', accuserId: 'p1', targetId: 'p0' },
      ctx,
    );
    expect(result.ok || result.error.code).toBe('no-uno-to-catch');
  });

  it('rejects a catch from an unknown accuser', () => {
    const state = game({
      hands: [hand('red-5'), hand('green-3')],
      top: card('red-9'),
      unoWindow: { playerId: 'p0' },
    });
    const result = applyAction(
      state,
      { type: 'catch-unfair-uno', accuserId: 'ghost', targetId: 'p0' },
      ctx,
    );
    expect(result.ok || result.error.code).toBe('unknown-player');
  });
});

describe('the window over a full turn', () => {
  it('closes as soon as the next player acts', () => {
    const red5 = card('red-5');
    const state = game({
      hands: [[red5, card('blue-1')], hand('green-3', 'yellow-4')],
      top: card('red-9'),
    });
    const opened = ok(
      applyAction(state, { type: 'play-card', playerId: 'p0', cardId: red5.id }, ctx),
    );
    expect(opened.state.unoWindow).toEqual({ playerId: 'p0' });

    const p1Draws = ok(applyAction(opened.state, { type: 'draw', playerId: 'p1' }, ctx));
    expect(p1Draws.state.unoWindow).toBeNull();
  });

  it('clears the standing call when the player draws back up', () => {
    const state = game({
      hands: [hand('red-5'), hand('green-3')],
      top: card('blue-9'),
      hasCalledUno: { p0: true },
      drawPile: hand('yellow-1', 'yellow-2'),
    });
    const drew = ok(applyAction(state, { type: 'draw', playerId: 'p0' }, ctx));
    expect(drew.state.players[0]?.hasCalledUno).toBe(false);
  });
});
