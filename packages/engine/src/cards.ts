export type CardColor = 'red' | 'yellow' | 'green' | 'blue';

export const CARD_COLORS: readonly CardColor[] = ['red', 'yellow', 'green', 'blue'];

/** A numbered card, 0 through 9, in one of the four colors. */
export interface NumberCard {
  readonly kind: 'number';
  readonly color: CardColor;
  readonly value: number;
  readonly id: string;
}

/** Skip, Reverse, and Draw Two. Colored, but their effect is what matters. */
export interface ColoredActionCard {
  readonly kind: 'skip' | 'reverse' | 'draw-two';
  readonly color: CardColor;
  readonly id: string;
}

/** Wild and Wild Draw Four. No color until a player chooses one. */
export interface WildCard {
  readonly kind: 'wild' | 'wild-draw-four';
  readonly id: string;
}

export type Card = NumberCard | ColoredActionCard | WildCard;

export type CardKind = Card['kind'];

export function isNumberCard(card: Card): card is NumberCard {
  return card.kind === 'number';
}

export function isWild(card: Card): card is WildCard {
  return card.kind === 'wild' || card.kind === 'wild-draw-four';
}

/** The three colored action cards. Wilds are handled on their own path. */
export function isActionCard(card: Card): card is ColoredActionCard {
  return card.kind === 'skip' || card.kind === 'reverse' || card.kind === 'draw-two';
}

/** Point value of a card when it is left in a hand at the end of a round. */
export function cardValue(card: Card): number {
  switch (card.kind) {
    case 'number':
      return card.value;
    case 'skip':
    case 'reverse':
    case 'draw-two':
      return 20;
    case 'wild':
    case 'wild-draw-four':
      return 50;
  }
}

/**
 * Whether `card` may be placed on the discard pile right now. `activeColor` is
 * the color currently in play, which is the chosen color when the top card is
 * a wild and the top card's own color otherwise. Wild Draw Four legality (the
 * challenge rule) is enforced by the reducer, not here: a wild always matches.
 */
export function canPlayOn(card: Card, top: Card, activeColor: CardColor): boolean {
  if (isWild(card)) {
    return true;
  }
  if (card.color === activeColor) {
    return true;
  }
  if (isNumberCard(card) && isNumberCard(top)) {
    return card.value === top.value;
  }
  if (!isNumberCard(top) && !isWild(top)) {
    return card.kind === top.kind;
  }
  return false;
}

const COPY_SUFFIX = ['a', 'b'] as const;

/**
 * A fresh 108-card deck in a fixed order. Callers shuffle it. Every card has a
 * stable id so hands can be diffed and animated by identity later.
 */
export function buildDeck(): Card[] {
  const deck: Card[] = [];

  for (const color of CARD_COLORS) {
    deck.push({ kind: 'number', color, value: 0, id: `${color}-0` });
    for (let value = 1; value <= 9; value += 1) {
      for (const copy of COPY_SUFFIX) {
        deck.push({ kind: 'number', color, value, id: `${color}-${String(value)}-${copy}` });
      }
    }
    for (const kind of ['skip', 'reverse', 'draw-two'] as const) {
      for (const copy of COPY_SUFFIX) {
        deck.push({ kind, color, id: `${color}-${kind}-${copy}` });
      }
    }
  }

  for (let n = 1; n <= 4; n += 1) {
    deck.push({ kind: 'wild', id: `wild-${String(n)}` });
    deck.push({ kind: 'wild-draw-four', id: `wild-draw-four-${String(n)}` });
  }

  return deck;
}
