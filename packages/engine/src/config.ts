/**
 * Which +2 / +4 cards may be stacked onto a pending draw instead of drawing.
 * `off` is the official tournament rule and the default.
 */
export type StackingRule = 'off' | 'draw-two' | 'draw-four' | 'both';

/**
 * How the first card of a round is handled when it is not a plain number.
 * `official` follows the printed rules. `simple` reshuffles anything that is not
 * a number, which some groups prefer.
 */
export type FirstCardRule = 'official' | 'simple';

export interface HouseRules {
  /** Stack +2 and/or +4 onto a pending draw rather than drawing it. */
  readonly stacking: StackingRule;
  /** Keep drawing until a playable card turns up, instead of drawing one. */
  readonly drawUntilPlayable: boolean;
  /** Let a player play the card they just drew, if it is playable. */
  readonly playDrawnCard: boolean;
  /** Play a matching card out of turn. Reserved; not handled by the engine yet. */
  readonly jumpIn: boolean;
  /** Cards drawn by a player caught not calling UNO. */
  readonly unoPenalty: number;
  /** Allow the next player to challenge a Wild Draw Four. */
  readonly wildFourChallenge: boolean;
  /** Match ends when a player reaches this score. */
  readonly targetScore: number;
  readonly firstCardRule: FirstCardRule;
}

const DEFAULTS: HouseRules = {
  stacking: 'off',
  drawUntilPlayable: false,
  playDrawnCard: true,
  jumpIn: false,
  unoPenalty: 2,
  wildFourChallenge: true,
  targetScore: 500,
  firstCardRule: 'official',
};

export function defaultHouseRules(overrides: Partial<HouseRules> = {}): HouseRules {
  return { ...DEFAULTS, ...overrides };
}
