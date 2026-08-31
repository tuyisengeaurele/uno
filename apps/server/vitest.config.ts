import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // Integration tests spin up a real server, real socket clients, and real
    // timers. Running the files in parallel makes the timing flaky, so don't.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/testing/**',
        'src/main.ts',
        'src/index.ts',
        // Type-only modules.
        'src/rooms/store.ts',
      ],
      // Raised to 100 in the final CI task once every handler and the
      // integration suite are in place.
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
  },
});
