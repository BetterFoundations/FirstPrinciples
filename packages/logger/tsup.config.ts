import { rmSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Two independent bundles so the browser build can never pull in pino or a
// Node built-in: esbuild only sees what a given entry file actually imports,
// and src/browser.ts imports neither. tsup runs a config array's builds
// concurrently, not in sequence, so a per-entry `clean: true` races the other
// entry's output — clean once here, synchronously, before either build starts.
rmSync('dist', { recursive: true, force: true });

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: false,
    splitting: false,
    platform: 'node',
    external: ['pino'],
  },
  {
    entry: { browser: 'src/browser.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: false,
    splitting: false,
    platform: 'browser',
  },
]);
