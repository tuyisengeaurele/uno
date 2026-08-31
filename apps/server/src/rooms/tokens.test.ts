import { describe, expect, it } from 'vitest';

import { createTokenRegistry } from './tokens.js';

describe('createTokenRegistry', () => {
  it('resolves an issued token back to its seat', () => {
    const registry = createTokenRegistry();
    const token = registry.issue('ABCJK2', 'seat-1');
    expect(registry.resolve(token)).toEqual({ code: 'ABCJK2', seatId: 'seat-1' });
  });

  it('returns undefined for an unknown token', () => {
    expect(createTokenRegistry().resolve('nope')).toBeUndefined();
  });

  it('issues distinct tokens', () => {
    const registry = createTokenRegistry();
    expect(registry.issue('ABCJK2', 'a')).not.toBe(registry.issue('ABCJK2', 'b'));
  });

  it('revokes every token for one room and leaves others intact', () => {
    const registry = createTokenRegistry();
    const doomed = registry.issue('ROOMAA', 's1');
    const alsoD = registry.issue('ROOMAA', 's2');
    const kept = registry.issue('ROOMBB', 's3');

    registry.revokeRoom('ROOMAA');

    expect(registry.resolve(doomed)).toBeUndefined();
    expect(registry.resolve(alsoD)).toBeUndefined();
    expect(registry.resolve(kept)).toEqual({ code: 'ROOMBB', seatId: 's3' });
  });
});
