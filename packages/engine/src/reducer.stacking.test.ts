import { describe, expect, it } from 'vitest';

import { createRng } from './rng.js';
import { applyAction, type ActionResult } from './reducer.js';
import { card, game, hand } from './__support__/factory.js';

const ctx = { rng: createRng(3) };

const ok = (result: ActionResult): Extract<ActionResult, { ok: true }> => {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}`);
  }
  return result;
};

describe('stacking off', () => {
  it('makes the next player draw the two and lose their turn', () => {
    const dt = card('red-draw-two');
    const state = game({
      hands: [[dt, card('red-1')], hand('blue-2', 'blue-3')],
      top: card('red-9'),
      drawPile: [card('yellow-1'), card('yellow-2'), card('yellow-3')],
    });

    const afterPlay = ok(
      applyAction(state, { type: 'play-card', playerId: 'p0', cardId: dt.id }, ctx),
    );
    expect(afterPlay.state.pendingDraw).toBe(2);
    expect(afterPlay.state.currentPlayerIndex).toBe(1);

    // p1 cannot answer with a normal card
    const blocked = applyAction(
      afterPlay.state,
      { type: 'play-card', playerId: 'p1', cardId: afterPlay.state.players[1]!.hand[0]!.id },
      ctx,
    );
    expect(blocked.ok || blocked.error.code).toBe('must-answer-draw');

    const afterDraw = ok(applyAction(afterPlay.state, { type: 'draw', playerId: 'p1' }, ctx));
    expect(afterDraw.state.players[1]?.hand).toHaveLength(4);
    expect(afterDraw.state.pendingDraw).toBe(0);
    expect(afterDraw.state.currentPlayerIndex).toBe(0);
    expect(afterDraw.events).toContainEqual({
      type: 'draw-penalty-served',
      playerId: 'p1',
      count: 2,
    });
  });
});

describe('stacking on', () => {
  it('lets the next player add another draw-two', () => {
    const dt0 = card('red-draw-two');
    const dt1 = card('blue-draw-two');
    const state = game({
      hands: [
        [dt0, card('red-1')],
        [dt1, card('green-3')],
      ],
      top: card('red-9'),
      config: { stacking: 'draw-two' },
    });

    const afterFirst = ok(
      applyAction(state, { type: 'play-card', playerId: 'p0', cardId: dt0.id }, ctx),
    );
    const afterSecond = ok(
      applyAction(afterFirst.state, { type: 'play-card', playerId: 'p1', cardId: dt1.id }, ctx),
    );

    expect(afterSecond.state.pendingDraw).toBe(4);
    expect(afterSecond.state.currentPlayerIndex).toBe(0);
    expect(afterSecond.state.players[1]?.hand).toHaveLength(1);
  });

  it('resolves a four-card chain into an eight-card draw', () => {
    const p0Cards = [card('red-draw-two'), card('green-draw-two'), card('yellow-draw-two')];
    const p1Cards = [card('blue-draw-two'), card('red-draw-two')];
    const drawPile = Array.from({ length: 12 }, (_, i) => card(`yellow-${String(i % 10)}`));
    const state = game({
      hands: [
        [...p0Cards, card('blue-0')],
        [...p1Cards, card('green-0')],
      ],
      top: card('red-9'),
      config: { stacking: 'draw-two' },
      drawPile,
    });

    let current = state;
    const sequence: [string, string][] = [
      ['p0', p0Cards[0]!.id],
      ['p1', p1Cards[0]!.id],
      ['p0', p0Cards[1]!.id],
      ['p1', p1Cards[1]!.id],
    ];
    for (const [playerId, cardId] of sequence) {
      current = ok(applyAction(current, { type: 'play-card', playerId, cardId }, ctx)).state;
    }
    expect(current.pendingDraw).toBe(8);

    const resolved = ok(applyAction(current, { type: 'draw', playerId: 'p0' }, ctx));
    expect(resolved.state.players[0]?.hand).toHaveLength(2 + 8);
    expect(resolved.state.pendingDraw).toBe(0);

    const cardsInPlay =
      resolved.state.players.reduce((sum, p) => sum + p.hand.length, 0) +
      resolved.state.drawPile.length +
      resolved.state.discardPile.length;
    expect(cardsInPlay).toBe(20); // 4 + 3 starting hands, 12 draw pile, 1 starting top
  });

  it('lets a draw-four extend a draw-two stack when the rule is "both"', () => {
    const dt = card('red-draw-two');
    const wd4 = card('wild-draw-four');
    const state = game({
      hands: [
        [dt, card('red-1')],
        [wd4, card('green-3')],
      ],
      top: card('red-9'),
      config: { stacking: 'both' },
    });

    const afterDt = ok(
      applyAction(state, { type: 'play-card', playerId: 'p0', cardId: dt.id }, ctx),
    );
    const afterWd4 = ok(
      applyAction(
        afterDt.state,
        { type: 'play-card', playerId: 'p1', cardId: wd4.id, chosenColor: 'green' },
        ctx,
      ),
    );

    expect(afterWd4.state.pendingDraw).toBe(6);
    expect(afterWd4.state.pendingDrawKind).toBe('draw-four');
  });

  it('does not let a draw-two answer a draw-four stack under the "draw-four" rule', () => {
    const wd4 = card('wild-draw-four');
    const dt = card('red-draw-two');
    const state = game({
      hands: [
        [wd4, card('red-1')],
        [dt, card('green-3')],
      ],
      top: card('red-9'),
      config: { stacking: 'draw-four' },
    });

    const afterWd4 = ok(
      applyAction(
        state,
        { type: 'play-card', playerId: 'p0', cardId: wd4.id, chosenColor: 'red' },
        ctx,
      ),
    );
    const blocked = applyAction(
      afterWd4.state,
      { type: 'play-card', playerId: 'p1', cardId: dt.id },
      ctx,
    );
    expect(blocked.ok || blocked.error.code).toBe('must-answer-draw');
  });
});
