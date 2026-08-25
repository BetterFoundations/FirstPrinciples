import { defineConfig } from 'vitest/config';
import { coverageThresholds } from '@firstprinciples/vitest-config';

export default defineConfig({
  test: {
    // Type-level tests (`tests/types/*.test-d.ts`) run in the same
    // `vitest run` as the runtime suites, so `turbo run test` and CI pick
    // them up with no extra wiring — the same pattern `core` and
    // `http-client` already established.
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
    },
    // Integration tests spin up real HTTP servers for each of the three
    // adapters and hit them with `fetch` — give them more headroom than
    // vitest's 5s default.
    testTimeout: 15000,
    coverage: {
      ...coverageThresholds,
      include: ['src/**/*.ts'],
    },
  },
});
