import { cardValue, type Card } from './cards.js';
import type { PlayerState } from './state.js';

/** Total point value of a hand, used when a round ends. */
export function handValue(hand: readonly Card[]): number {
  return hand.reduce((sum, card) => sum + cardValue(card), 0);
}

export interface RoundTally {
  readonly scores: Record<string, number>;
  /** The winner's new running total. */
  readonly winnerTotal: number;
}

/**
 * Add the round's points to the winner's running total. The winner scores the
 * sum of every other player's remaining hand.
 */
export function tallyRound(
  players: readonly PlayerState[],
  winnerId: string,
  priorScores: Readonly<Record<string, number>>,
): RoundTally {
  const gained = players
    .filter((player) => player.id !== winnerId)
    .reduce((sum, player) => sum + handValue(player.hand), 0);

  const winnerTotal = (priorScores[winnerId] ?? 0) + gained;
  return { scores: { ...priorScores, [winnerId]: winnerTotal }, winnerTotal };
}
