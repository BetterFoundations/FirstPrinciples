import { defineConfig } from 'vitest/config';
import { coverageThresholds } from '@firstprinciples/vitest-config';

export default defineConfig({
  test: {
    // Type-level tests (`tests/types/*.test-d.ts`) run in the same
    // `vitest run` as the runtime suites, so `turbo run test` and CI pick
    // them up with no extra wiring — see core's and http-client's configs.
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
    },
    // The real-Redis testcontainers suite spins up a container per run;
    // give it more headroom than the 5s default, especially on a cold
    // CI runner pulling the image for the first time.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      ...coverageThresholds,
      include: ['src/**/*.ts'],
    },
  },
});
