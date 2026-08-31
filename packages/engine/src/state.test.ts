import { describe, expect, it } from 'vitest';

import { buildDeck } from './cards.js';
import { defaultHouseRules } from './config.js';
import { currentPlayer, playerById, topCard, type GameState } from './state.js';

const deck = buildDeck();

const fixture = (): GameState => ({
  players: [
    { id: 'a', name: 'Ada', hand: deck.slice(0, 7), hasCalledUno: false },
    { id: 'b', name: 'Béla', hand: deck.slice(7, 14), hasCalledUno: false },
  ],
  currentPlayerIndex: 0,
  direction: 1,
  drawPile: deck.slice(15),
  discardPile: deck.slice(14, 15),
  activeColor: 'red',
  pendingDraw: 0,
  pendingDrawKind: null,
  pendingWildFour: null,
  pendingColorChoice: null,
  drawnCard: null,
  unoWindow: null,
  status: 'active',
  roundWinnerId: null,
  scores: { a: 0, b: 0 },
  config: defaultHouseRules(),
  startingPlayerIndex: 0,
});

describe('game state', () => {
  it('survives a JSON round trip unchanged', () => {
    const state = fixture();
    const roundTripped = JSON.parse(JSON.stringify(state)) as GameState;
    expect(roundTripped).toEqual(state);
  });

  it('currentPlayer returns the player whose turn it is', () => {
    expect(currentPlayer(fixture()).id).toBe('a');
  });

  it('currentPlayer throws when the index is out of range', () => {
    expect(() => currentPlayer({ ...fixture(), currentPlayerIndex: 5 })).toThrow(RangeError);
  });

  it('playerById finds a player or returns undefined', () => {
    const state = fixture();
    expect(playerById(state, 'b')?.name).toBe('Béla');
    expect(playerById(state, 'nobody')).toBeUndefined();
  });

  it('topCard is the last card on the discard pile', () => {
    const state = fixture();
    expect(topCard(state)).toBe(state.discardPile.at(-1));
  });
});
