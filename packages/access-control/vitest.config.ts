import { defineConfig } from 'vitest/config';
import { coverageThresholds } from '@firstprinciples/vitest-config';

export default defineConfig({
  test: {
    // Type-level tests (`tests/types/*.test-d.ts`) run in the same
    // `vitest run` as the runtime suites, so `turbo run test` and CI pick
    // them up with no extra wiring — the pattern `core`, `http-client` and
    // `api-kit` already established. Spec §5 names `access-control` as one
    // of the three packages whose generics warrant them.
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
    },
    // The guard conformance suites spin up real HTTP servers on loopback for
    // each of the three frameworks and drive the whole shared decision table
    // through them — more than vitest's 5s default deserves.
    testTimeout: 20000,
    // The React suites opt into jsdom per-file with a
    // `// @vitest-environment jsdom` docblock; everything else stays on the
    // default node environment, so the engine is exercised exactly as a
    // server would run it.
    coverage: {
      ...coverageThresholds,
      include: ['src/**/*.ts'],
    },
  },
});
