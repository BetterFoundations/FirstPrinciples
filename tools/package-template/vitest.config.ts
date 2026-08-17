import { defineConfig } from 'vitest/config';
import { coverageThresholds } from '@firstprinciples/vitest-config';

export default defineConfig({
  test: {
    coverage: {
      ...coverageThresholds,
      include: ['src/**/*.ts'],
    },
  },
});
