import { describe, expect, it } from 'vitest';

import { createRng } from '@uno/engine';

import { generateRoomCode, uniqueRoomCode } from './codes.js';

const seeded = (seed: number) => {
  const rng = createRng(seed);
  return () => rng.next();
};

describe('generateRoomCode', () => {
  it('returns six characters', () => {
    expect(generateRoomCode(seeded(1))).toHaveLength(6);
  });

  it('never uses lookalike characters', () => {
    const random = seeded(42);
    for (let i = 0; i < 2000; i += 1) {
      expect(generateRoomCode(random)).not.toMatch(/[IO01]/);
    }
  });

  it('uses only the safe alphabet', () => {
    const random = seeded(7);
    for (let i = 0; i < 500; i += 1) {
      expect(generateRoomCode(random)).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });
});

describe('uniqueRoomCode', () => {
  it('returns a code the taken check reports as free', () => {
    const code = uniqueRoomCode(() => false, seeded(3));
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it('retries past collisions', () => {
    const taken = new Set<string>();
    const random = seeded(99);
    // Mark the first two codes this seed produces as taken.
    taken.add(generateRoomCode(seeded(99)));
    const second = (() => {
      const r = seeded(99);
      generateRoomCode(r);
      return generateRoomCode(r);
    })();
    taken.add(second);

    const code = uniqueRoomCode((c) => taken.has(c), random);
    expect(taken.has(code)).toBe(false);
  });

  it('gives up after fifty straight collisions', () => {
    expect(() => uniqueRoomCode(() => true, seeded(1))).toThrow(/free room code/);
  });
});
