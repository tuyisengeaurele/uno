import { describe, expect, it } from 'vitest';

import { createRng } from './rng.js';
import { applyAction, type ActionResult } from './reducer.js';
import { card, game, hand } from './__support__/factory.js';

const ctx = { rng: createRng(5) };

const ok = (result: ActionResult): Extract<ActionResult, { ok: true }> => {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}`);
  }
  return result;
};

const bigPile = () => Array.from({ length: 15 }, (_, i) => card(`yellow-${String(i % 10)}`));

describe('playing a wild draw four', () => {
  it('records the colour in play and whether the player could have followed it', () => {
    const wd4 = card('wild-draw-four');
    const state = game({
      hands: [[wd4, card('red-2'), card('green-8')], hand('blue-1')],
      top: card('red-9'),
      drawPile: bigPile(),
    });
    const played = ok(
      applyAction(
        state,
        { type: 'play-card', playerId: 'p0', cardId: wd4.id, chosenColor: 'blue' },
        ctx,
      ),
    );

    expect(played.state.pendingWildFour).toEqual({
      playedBy: 'p0',
      colorBefore: 'red',
      hadColorMatch: true, // p0 still holds red-2
    });
    expect(played.state.pendingDraw).toBe(4);
  });

  it('leaves no challenge record when the challenge rule is off', () => {
    const wd4 = card('wild-draw-four');
    const state = game({
      hands: [[wd4, card('red-2')], hand('blue-1')],
      top: card('red-9'),
      config: { wildFourChallenge: false },
      drawPile: bigPile(),
    });
    const played = ok(
      applyAction(
        state,
        { type: 'play-card', playerId: 'p0', cardId: wd4.id, chosenColor: 'blue' },
        ctx,
      ),
    );
    expect(played.state.pendingWildFour).toBeNull();
  });
});

describe('resolving a challenge', () => {
  const setup = (p0Hand: string[]) => {
    const wd4 = card('wild-draw-four');
    const state = game({
      hands: [[wd4, ...hand(...p0Hand)], hand('blue-1', 'blue-2')],
      top: card('red-9'),
      drawPile: bigPile(),
    });
    return {
      wd4,
      played: ok(
        applyAction(
          state,
          { type: 'play-card', playerId: 'p0', cardId: wd4.id, chosenColor: 'green' },
          ctx,
        ),
      ).state,
    };
  };

  it('stands when the player held a matching colour: they draw four, challenger keeps the turn', () => {
    const { played } = setup(['red-2', 'yellow-5']); // held red, so the wild four was illegal
    const resolved = ok(
      applyAction(played, { type: 'challenge-wild-four', challengerId: 'p1' }, ctx),
    );

    expect(resolved.state.players[0]?.hand).toHaveLength(2 + 4);
    expect(resolved.state.pendingDraw).toBe(0);
    expect(resolved.state.currentPlayerIndex).toBe(1);
    expect(resolved.events).toEqual([
      { type: 'challenge-resolved', challengerId: 'p1', targetId: 'p0', upheld: true, penalty: 4 },
    ]);
  });

  it('fails when the player had no matching colour: challenger draws six and is skipped', () => {
    const { played } = setup(['blue-4', 'yellow-5']); // no red, the wild four was legal
    const resolved = ok(
      applyAction(played, { type: 'challenge-wild-four', challengerId: 'p1' }, ctx),
    );

    expect(resolved.state.players[1]?.hand).toHaveLength(2 + 6);
    expect(resolved.state.currentPlayerIndex).toBe(0);
    expect(resolved.events).toEqual([
      { type: 'challenge-resolved', challengerId: 'p1', targetId: 'p0', upheld: false, penalty: 6 },
    ]);
  });

  it('treats a hand of only wilds and off-colour cards as a legal wild four', () => {
    const { played } = setup(['blue-4', 'wild']);
    const resolved = ok(
      applyAction(played, { type: 'challenge-wild-four', challengerId: 'p1' }, ctx),
    );
    expect(resolved.events[0]).toMatchObject({ upheld: false });
  });

  it('is gone once the challenger has drawn', () => {
    const { played } = setup(['red-2']);
    const drew = ok(applyAction(played, { type: 'draw', playerId: 'p1' }, ctx));
    const late = applyAction(drew.state, { type: 'challenge-wild-four', challengerId: 'p1' }, ctx);
    expect(late.ok || late.error.code).toBe('challenge-not-available');
  });

  it('rejects a challenge from anyone but the player facing the card', () => {
    const wd4 = card('wild-draw-four');
    const state = game({
      hands: [[wd4, card('red-2')], hand('blue-1'), hand('green-3')],
      top: card('red-9'),
      drawPile: bigPile(),
    });
    const played = ok(
      applyAction(
        state,
        { type: 'play-card', playerId: 'p0', cardId: wd4.id, chosenColor: 'green' },
        ctx,
      ),
    );
    const wrong = applyAction(
      played.state,
      { type: 'challenge-wild-four', challengerId: 'p2' },
      ctx,
    );
    expect(wrong.ok || wrong.error.code).toBe('challenge-not-available');
  });
});
