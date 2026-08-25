import { defineConfig } from 'vitest/config';
import { coverageThresholds } from '@firstprinciples/vitest-config';

export default defineConfig({
  test: {
    // Type-level tests (`tests/types/*.test-d.ts`) run in the same
    // `vitest run` as the runtime suites, so `turbo run test` and CI
    // pick them up with no extra wiring.
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
    },
    // Every password test spends a real argon2id derivation (~24ms at
    // the defaults, and the parameter tests deliberately go higher), and
    // the timing suites run many of them back to back.
    testTimeout: 30000,
    coverage: {
      ...coverageThresholds,
      include: ['src/**/*.ts'],
    },
  },
});
