import { describe, expect, it } from 'vitest';

import { buildDeck, type Card } from './cards.js';
import { deal, drawCards, shuffle } from './deck.js';
import { createRng } from './rng.js';

const ids = (cards: readonly Card[]): string[] => cards.map((c) => c.id).sort();

describe('shuffle', () => {
  it('keeps the same multiset of cards', () => {
    const deck = buildDeck();
    const shuffled = shuffle(deck, createRng(1));
    expect(shuffled).toHaveLength(deck.length);
    expect(ids(shuffled)).toEqual(ids(deck));
  });

  it('does not mutate the input', () => {
    const deck = buildDeck();
    const before = deck.map((c) => c.id);
    shuffle(deck, createRng(1));
    expect(deck.map((c) => c.id)).toEqual(before);
  });

  it('is deterministic for a seed', () => {
    const deck = buildDeck();
    expect(shuffle(deck, createRng(7)).map((c) => c.id)).toEqual(
      shuffle(deck, createRng(7)).map((c) => c.id),
    );
  });

  it('actually reorders the deck', () => {
    const deck = buildDeck();
    expect(shuffle(deck, createRng(3)).map((c) => c.id)).not.toEqual(deck.map((c) => c.id));
  });
});

describe('deal', () => {
  it('gives each of two players seven cards and leaves 94 in the draw pile', () => {
    const { hands, drawPile } = deal(shuffle(buildDeck(), createRng(1)), 2, 7);
    expect(hands).toHaveLength(2);
    expect(hands.every((h) => h.length === 7)).toBe(true);
    expect(drawPile).toHaveLength(94);
  });

  it('conserves every card', () => {
    const deck = shuffle(buildDeck(), createRng(9));
    const { hands, drawPile } = deal(deck, 4, 7);
    const dealt = [...hands.flat(), ...drawPile];
    expect(ids(dealt)).toEqual(ids(deck));
  });

  it('throws when the deck cannot cover the deal', () => {
    expect(() => deal(buildDeck().slice(0, 5), 2, 7)).toThrow(RangeError);
  });
});

describe('drawCards', () => {
  it('moves cards off the draw pile when it has enough', () => {
    const deck = buildDeck();
    const drawPile = deck.slice(0, 10);
    const discardPile = deck.slice(10, 11);
    const result = drawCards(drawPile, discardPile, 3, createRng(1));

    expect(result.drawn).toHaveLength(3);
    expect(result.drawPile).toHaveLength(7);
    expect(result.discardPile).toEqual(discardPile);
    expect(ids([...result.drawn, ...result.drawPile])).toEqual(ids(drawPile));
  });

  it('does not mutate its inputs', () => {
    const deck = buildDeck();
    const drawPile = deck.slice(0, 10);
    const discardPile = deck.slice(10, 15);
    drawCards(drawPile, discardPile, 4, createRng(1));
    expect(drawPile).toHaveLength(10);
    expect(discardPile).toHaveLength(5);
  });

  it('reshuffles the discard pile when the draw pile runs dry', () => {
    const deck = buildDeck();
    const drawPile = deck.slice(0, 2);
    const discardPile = deck.slice(2, 20); // 18 cards, top is the last one
    const top = discardPile.at(-1);
    const result = drawCards(drawPile, discardPile, 6, createRng(5));

    expect(result.drawn).toHaveLength(6);
    expect(result.discardPile).toHaveLength(1);
    expect(result.discardPile.at(0)).toBe(top);

    const everything = [...result.drawn, ...result.drawPile, ...result.discardPile];
    expect(ids(everything)).toEqual(ids([...drawPile, ...discardPile]));
  });

  it('stops early when neither pile can give another card', () => {
    const deck = buildDeck();
    const drawPile = deck.slice(0, 2);
    const discardPile = deck.slice(2, 3); // only the top card, nothing to reshuffle
    const result = drawCards(drawPile, discardPile, 10, createRng(1));

    expect(result.drawn).toHaveLength(2);
    expect(result.drawPile).toHaveLength(0);
    expect(result.discardPile).toEqual(discardPile);
  });
});
