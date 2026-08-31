/**
 * A small deterministic random source. The engine never touches `Math.random`,
 * so every shuffle and draw is reproducible from a seed. That is what lets us
 * replay a reported game exactly.
 */
export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [0, maxExclusive). `maxExclusive` must be at least 1. */
  int(maxExclusive: number): number;
  /**
   * The current internal state. Pass it back to `createRng` as the second
   * argument to resume the sequence exactly, so a game's RNG can be persisted
   * alongside its state.
   */
  readonly state: number;
}

/**
 * mulberry32. Fast, tiny, and good enough for shuffling a card deck. Not for
 * anything that needs cryptographic randomness. Pass `resumeFrom` (a value read
 * from `rng.state`) to continue a sequence that was persisted earlier.
 */
export function createRng(seed: number, resumeFrom?: number): Rng {
  let state = (resumeFrom ?? seed) >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
        throw new RangeError(`int() needs a positive integer bound, got ${String(maxExclusive)}`);
      }
      return Math.floor(next() * maxExclusive);
    },
    get state(): number {
      return state;
    },
  };
}
