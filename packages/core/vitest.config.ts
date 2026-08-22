import { defineConfig } from 'vitest/config';
import { coverageThresholds } from '@firstprinciples/vitest-config';

export default defineConfig({
  test: {
    // Type-level tests (`tests/types/*.test-d.ts`) run in the same
    // `vitest run` as the runtime suites, so `turbo run test` and CI pick
    // them up with no extra wiring. Generics that don't infer are a
    // design bug in this package, not a documentation gap.
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
    },
    coverage: {
      ...coverageThresholds,
      include: ['src/**/*.ts'],
    },
  },
});
