import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'src/e2e/**'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 15_000,
    env: { OPENAI_API_KEY: 'test-key-for-unit-tests' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.integration.test.ts',
        'src/e2e/**',
        'src/index.ts',
        'src/__test__/**',
      ],
    },
  },
});
