// Coverage thresholds match spec §5: lines/statements 90%, branches 85%, functions 90%.
// Vitest fails its own process (and so the `test` turbo task) when a package drops below these.
export const coverageThresholds = {
  provider: 'v8',
  reporter: ['text', 'html', 'json-summary'],
  reportsDirectory: 'coverage',
  thresholds: {
    lines: 90,
    branches: 85,
    functions: 90,
    statements: 90,
  },
};
