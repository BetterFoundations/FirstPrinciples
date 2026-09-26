import { defineConfig } from 'tsup';

export default defineConfig({
  // One entry, so there is exactly one copy of every class in the build —
  // the duplicate-class hazard from S16 decision 14 needs two entries.
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  platform: 'node',
  external: ['@firstprinciples/core', 'bullmq'],
});
