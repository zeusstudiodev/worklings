import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    // The CLI tests start real Node processes, which takes seconds each on Windows while the suite runs in parallel.
    testTimeout: 30_000,
  },
});
