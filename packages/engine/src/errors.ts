export type GameErrorCode =
  | 'game-not-active'
  | 'not-your-turn'
  | 'unknown-player'
  | 'card-not-in-hand'
  | 'illegal-play'
  | 'color-required'
  | 'color-not-expected'
  | 'must-answer-draw'
  | 'resolve-color-choice'
  | 'draw-first'
  | 'nothing-to-pass'
  | 'card-not-drawn'
  | 'uno-not-available'
  | 'no-uno-to-catch'
  | 'challenge-not-available';

export interface GameError {
  readonly code: GameErrorCode;
  readonly message: string;
}

export function gameError(code: GameErrorCode, message: string): GameError {
  return { code, message };
}
