import type { CardColor } from './cards.js';

/**
 * Everything a player can ask the engine to do. The server validates the sender
 * against `playerId` before this reaches the reducer; the reducer still checks
 * that the move itself is legal.
 */
export type GameAction =
  | {
      readonly type: 'play-card';
      readonly playerId: string;
      readonly cardId: string;
      readonly chosenColor?: CardColor;
    }
  | { readonly type: 'draw'; readonly playerId: string }
  | {
      readonly type: 'play-drawn';
      readonly playerId: string;
      readonly cardId: string;
      readonly chosenColor?: CardColor;
    }
  | { readonly type: 'pass'; readonly playerId: string }
  | { readonly type: 'choose-color'; readonly playerId: string; readonly color: CardColor }
  | { readonly type: 'call-uno'; readonly playerId: string }
  | { readonly type: 'catch-unfair-uno'; readonly accuserId: string; readonly targetId: string }
  | { readonly type: 'challenge-wild-four'; readonly challengerId: string };

export type GameActionType = GameAction['type'];
