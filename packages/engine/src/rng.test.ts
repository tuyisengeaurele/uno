import { describe, expect, it } from 'vitest';

import { createRng } from './rng.js';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('diverges for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('keeps next() in [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('keeps int(n) in [0, n)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 10_000; i += 1) {
      const value = rng.int(13);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(13);
    }
  });

  it('rejects a bound below 1', () => {
    const rng = createRng(1);
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.int(-5)).toThrow(RangeError);
    expect(() => rng.int(2.5)).toThrow(RangeError);
  });

  it('distributes int(n) roughly evenly', () => {
    const rng = createRng(2026);
    const buckets = 10;
    const draws = 100_000;
    const counts = new Array<number>(buckets).fill(0);
    for (let i = 0; i < draws; i += 1) {
      const bucket = rng.int(buckets);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    const expected = draws / buckets;
    const chiSquare = counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
    // df = 9, critical value at p = 0.001 is 27.877. A well-behaved generator
    // sits well under that.
    expect(chiSquare).toBeLessThan(27.877);
  });
});
