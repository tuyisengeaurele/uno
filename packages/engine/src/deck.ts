import type { Card } from './cards.js';
import type { Rng } from './rng.js';

/**
 * A uniform random permutation. Repeatedly pulls a random card out of a working
 * copy, so it never indexes past the end and needs no bounds assertions. O(n^2),
 * which is nothing for a 108-card deck shuffled once per round.
 */
export function shuffle(cards: readonly Card[], rng: Rng): Card[] {
  const source = [...cards];
  const result: Card[] = [];
  while (source.length > 0) {
    const [card] = source.splice(rng.int(source.length), 1) as [Card];
    result.push(card);
  }
  return result;
}

/** Deal `handSize` cards to each player, one at a time, and keep the rest. */
export function deal(
  deck: readonly Card[],
  playerCount: number,
  handSize: number,
): { hands: Card[][]; drawPile: Card[] } {
  const drawPile = [...deck];
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);

  for (let round = 0; round < handSize; round += 1) {
    for (const hand of hands) {
      const card = drawPile.shift();
      if (card === undefined) {
        throw new RangeError('deck does not have enough cards to deal');
      }
      hand.push(card);
    }
  }

  return { hands, drawPile };
}

export interface DrawResult {
  readonly drawn: Card[];
  readonly drawPile: Card[];
  readonly discardPile: Card[];
}

/**
 * Take `count` cards off the draw pile. When it runs out, the discard pile below
 * its top card is shuffled back in and drawing continues. If neither pile can
 * give another card, drawing stops and the caller gets however many it managed
 * to take. Inputs are not mutated.
 */
export function drawCards(
  drawPile: readonly Card[],
  discardPile: readonly Card[],
  count: number,
  rng: Rng,
): DrawResult {
  let pile = [...drawPile];
  let discard = [...discardPile];
  const drawn: Card[] = [];

  for (let i = 0; i < count; i += 1) {
    if (pile.length === 0) {
      const rest = discard.slice(0, -1);
      if (rest.length === 0) {
        break;
      }
      pile = shuffle(rest, rng);
      discard = discard.slice(-1);
    }

    // The block above guarantees the pile is not empty here.
    const [card] = pile.splice(0, 1) as [Card];
    drawn.push(card);
  }

  return { drawn, drawPile: pile, discardPile: discard };
}
