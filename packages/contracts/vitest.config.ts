import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      // events.ts, errors.ts, and views.ts are type-only: nothing to execute.
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/events.ts',
        'src/errors.ts',
        'src/views.ts',
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
