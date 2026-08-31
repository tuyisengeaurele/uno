import { describe, expect, it } from 'vitest';

import { defaultHouseRules } from './config.js';

describe('defaultHouseRules', () => {
  it('matches the documented defaults', () => {
    expect(defaultHouseRules()).toEqual({
      stacking: 'off',
      drawUntilPlayable: false,
      playDrawnCard: true,
      jumpIn: false,
      unoPenalty: 2,
      wildFourChallenge: true,
      targetScore: 500,
      firstCardRule: 'official',
    });
  });

  it('applies overrides on top of the defaults', () => {
    const rules = defaultHouseRules({ stacking: 'both', unoPenalty: 4 });
    expect(rules.stacking).toBe('both');
    expect(rules.unoPenalty).toBe(4);
    expect(rules.targetScore).toBe(500);
  });

  it('returns a fresh object each call', () => {
    expect(defaultHouseRules()).not.toBe(defaultHouseRules());
  });
});
