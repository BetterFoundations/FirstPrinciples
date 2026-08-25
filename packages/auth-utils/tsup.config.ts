import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entries. `index` is the whole toolkit and statically imports
  // the native `argon2` binding; `jwt` is pure JavaScript and does not,
  // so it runs on edge runtimes and in bundles where a `.node` binary
  // cannot go. Asserted in `tests/integration/dist-entrypoints.test.ts`.
  entry: {
    index: 'src/index.ts',
    jwt: 'src/jwt.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  // Peer dependency: the consumer's install owns the native binary.
  external: ['argon2'],
});
