import { defineConfig } from 'vitest/config';
import { coverageThresholds } from '@firstprinciples/vitest-config';

export default defineConfig({
  test: {
    // Type-level tests (`tests/types/*.test-d.ts`) run in the same
    // `vitest run` as the runtime suites, so `turbo run test` and CI pick
    // them up with no extra wiring. The ApiResult widening this package
    // depends on (core's S7 layering decision) is a compile-time contract,
    // not a runtime one.
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
