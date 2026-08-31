import { describe, expect, it } from 'vitest';

import { nextIndex, reverse } from './turn.js';

describe('nextIndex', () => {
  it('moves forward and wraps', () => {
    expect(nextIndex(0, 1, 4)).toBe(1);
    expect(nextIndex(3, 1, 4)).toBe(0);
  });

  it('moves backward and wraps', () => {
    expect(nextIndex(2, -1, 4)).toBe(1);
    expect(nextIndex(0, -1, 4)).toBe(3);
  });

  it('skips a seat with step 2', () => {
    expect(nextIndex(0, 1, 4, 2)).toBe(2);
    expect(nextIndex(3, 1, 4, 2)).toBe(1);
    expect(nextIndex(0, -1, 4, 2)).toBe(2);
  });

  it('lands on the same seat when step wraps a two-player table', () => {
    expect(nextIndex(0, 1, 2, 2)).toBe(0);
    expect(nextIndex(1, -1, 2, 2)).toBe(1);
  });
});

describe('reverse', () => {
  it('flips direction both ways', () => {
    expect(reverse(1)).toBe(-1);
    expect(reverse(-1)).toBe(1);
  });
});
