import { describe, expect, it } from 'vitest';

import * as contracts from './index.js';

describe('package entry point', () => {
  it('loads', () => {
    expect(contracts).toBeTypeOf('object');
  });
});
