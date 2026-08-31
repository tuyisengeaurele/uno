import { describe, expect, it } from 'vitest';

import * as engine from './index.js';

describe('package entry point', () => {
  it('loads', () => {
    expect(engine).toBeTypeOf('object');
  });
});
