import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts', 'src/e2e/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 30_000,
    env: { OPENAI_API_KEY: 'test-key-for-integration-tests' },
  },
});
