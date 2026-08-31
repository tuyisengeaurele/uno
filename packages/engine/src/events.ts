import type { Card, CardColor } from './cards.js';
import type { Direction } from './turn.js';

/**
 * What happened when an action was applied. The realtime layer broadcasts these
 * and the client animates from them. Tests assert against them because they are
 * more precise than only checking the resulting state.
 */
export type GameEvent =
  | { readonly type: 'card-played'; readonly playerId: string; readonly card: Card }
  | { readonly type: 'color-chosen'; readonly playerId: string; readonly color: CardColor }
  | {
      readonly type: 'player-drew';
      readonly playerId: string;
      readonly count: number;
      /** True when some of the cards came from reshuffling the discard pile. */
      readonly reshuffled: boolean;
    }
  | { readonly type: 'turn-skipped'; readonly playerId: string }
  | { readonly type: 'direction-reversed'; readonly direction: Direction }
  | {
      readonly type: 'draw-penalty-served';
      readonly playerId: string;
      readonly count: number;
    }
  | { readonly type: 'uno-called'; readonly playerId: string }
  | {
      readonly type: 'uno-penalty';
      readonly playerId: string;
      readonly accuserId: string;
      readonly count: number;
    }
  | {
      readonly type: 'challenge-resolved';
      readonly challengerId: string;
      readonly targetId: string;
      /** True when the challenge stood: the Wild Draw Four was illegal. */
      readonly upheld: boolean;
      readonly penalty: number;
    }
  | {
      readonly type: 'round-ended';
      readonly winnerId: string;
      readonly scores: Readonly<Record<string, number>>;
    }
  | {
      readonly type: 'match-ended';
      readonly winnerId: string;
      readonly scores: Readonly<Record<string, number>>;
    };

export type GameEventType = GameEvent['type'];
