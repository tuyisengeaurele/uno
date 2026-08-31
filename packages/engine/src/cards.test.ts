import { describe, expect, it } from 'vitest';

import {
  buildDeck,
  canPlayOn,
  cardValue,
  isActionCard,
  isWild,
  type Card,
  type CardColor,
} from './cards.js';

const number = (color: CardColor, value: number): Card => ({
  kind: 'number',
  color,
  value,
  id: `${color}-${String(value)}-test`,
});

describe('buildDeck', () => {
  const deck = buildDeck();

  it('has 108 cards', () => {
    expect(deck).toHaveLength(108);
  });

  it('has one zero and two of each 1-9 per color', () => {
    for (const color of ['red', 'yellow', 'green', 'blue'] as const) {
      const numbers = deck.filter((c) => c.kind === 'number' && c.color === color);
      expect(numbers.filter((c) => c.kind === 'number' && c.value === 0)).toHaveLength(1);
      for (let value = 1; value <= 9; value += 1) {
        expect(numbers.filter((c) => c.kind === 'number' && c.value === value)).toHaveLength(2);
      }
    }
  });

  it('has two skip, reverse, and draw-two per color', () => {
    for (const color of ['red', 'yellow', 'green', 'blue'] as const) {
      for (const kind of ['skip', 'reverse', 'draw-two'] as const) {
        expect(
          deck.filter((c) => c.kind === kind && 'color' in c && c.color === color),
        ).toHaveLength(2);
      }
    }
  });

  it('has four wild and four wild-draw-four', () => {
    expect(deck.filter((c) => c.kind === 'wild')).toHaveLength(4);
    expect(deck.filter((c) => c.kind === 'wild-draw-four')).toHaveLength(4);
  });

  it('gives every card a unique id', () => {
    const ids = new Set(deck.map((c) => c.id));
    expect(ids.size).toBe(deck.length);
  });

  it('returns a fresh array each call', () => {
    expect(buildDeck()).not.toBe(deck);
  });
});

describe('cardValue', () => {
  it('scores number cards at face value', () => {
    expect(cardValue(number('red', 0))).toBe(0);
    expect(cardValue(number('blue', 9))).toBe(9);
  });

  it('scores skip, reverse, and draw-two at 20', () => {
    expect(cardValue({ kind: 'skip', color: 'red', id: 'x' })).toBe(20);
    expect(cardValue({ kind: 'reverse', color: 'red', id: 'x' })).toBe(20);
    expect(cardValue({ kind: 'draw-two', color: 'red', id: 'x' })).toBe(20);
  });

  it('scores wilds at 50', () => {
    expect(cardValue({ kind: 'wild', id: 'x' })).toBe(50);
    expect(cardValue({ kind: 'wild-draw-four', id: 'x' })).toBe(50);
  });
});

describe('type guards', () => {
  it('isWild covers both wild kinds and nothing else', () => {
    expect(isWild({ kind: 'wild', id: 'x' })).toBe(true);
    expect(isWild({ kind: 'wild-draw-four', id: 'x' })).toBe(true);
    expect(isWild(number('red', 3))).toBe(false);
    expect(isWild({ kind: 'skip', color: 'red', id: 'x' })).toBe(false);
  });

  it('isActionCard covers the three colored actions only', () => {
    expect(isActionCard({ kind: 'skip', color: 'red', id: 'x' })).toBe(true);
    expect(isActionCard({ kind: 'reverse', color: 'red', id: 'x' })).toBe(true);
    expect(isActionCard({ kind: 'draw-two', color: 'red', id: 'x' })).toBe(true);
    expect(isActionCard(number('red', 3))).toBe(false);
    expect(isActionCard({ kind: 'wild', id: 'x' })).toBe(false);
  });
});

describe('canPlayOn', () => {
  it('matches on color', () => {
    expect(canPlayOn(number('red', 3), number('red', 8), 'red')).toBe(true);
  });

  it('matches a number on an equal number of another color', () => {
    expect(canPlayOn(number('blue', 7), number('red', 7), 'red')).toBe(true);
  });

  it('rejects a mismatched number and color', () => {
    expect(canPlayOn(number('blue', 7), number('red', 3), 'red')).toBe(false);
  });

  it('matches an action card on the same action of another color', () => {
    const blueSkip: Card = { kind: 'skip', color: 'blue', id: 'a' };
    const redSkip: Card = { kind: 'skip', color: 'red', id: 'b' };
    expect(canPlayOn(blueSkip, redSkip, 'red')).toBe(true);
  });

  it('does not match a draw-two on a skip', () => {
    const draw: Card = { kind: 'draw-two', color: 'blue', id: 'a' };
    const skip: Card = { kind: 'skip', color: 'red', id: 'b' };
    expect(canPlayOn(draw, skip, 'red')).toBe(false);
  });

  it('lets a wild play on anything', () => {
    expect(canPlayOn({ kind: 'wild', id: 'a' }, number('red', 3), 'red')).toBe(true);
    expect(canPlayOn({ kind: 'wild-draw-four', id: 'a' }, number('red', 3), 'red')).toBe(true);
  });

  it('uses the active color when the top card is a wild', () => {
    const wildTop: Card = { kind: 'wild', id: 'w' };
    expect(canPlayOn(number('green', 5), wildTop, 'green')).toBe(true);
    expect(canPlayOn(number('red', 5), wildTop, 'green')).toBe(false);
  });
});
