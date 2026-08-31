import { describe, expect, it } from 'vitest';

import * as server from './index.js';

describe('package entry point', () => {
  it('loads', () => {
    expect(server).toBeTypeOf('object');
  });
});
