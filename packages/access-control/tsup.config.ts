import { defineConfig } from 'tsup';

export default defineConfig({
  // Five independent entries, not one. `index` is the engine: framework-free,
  // isomorphic, and the only thing a policy-authoring module ever needs.
  // Each adapter is its own subpath so a consumer importing `./react` never
  // pulls Express in, and a server importing `./express` never pulls React in
  // — asserted in `tests/integration/dist-bundle.test.ts`.
  entry: {
    index: 'src/index.ts',
    react: 'src/react.ts',
    express: 'src/express.ts',
    fastify: 'src/fastify.ts',
    hono: 'src/hono.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // On for correctness, not for size. With `splitting: false`, each entry
  // is bundled independently, so `dist/index.js` and `dist/express.js`
  // each defined their *own* `PermissionDeniedError` — and
  // `error instanceof PermissionDeniedError`, written against the import
  // from the main entry, was `false` for the error a guard threw. Caught
  // by `examples/access-control`, which returned 500 where it should have
  // returned 403; missed by every source-level test, because those import
  // through one module graph. Splitting hoists the shared modules into a
  // chunk both entries import, which esbuild does for ESM and tsup
  // arranges for CJS too. `tests/integration/dist-bundle.test.ts` asserts
  // the identity holds in both formats, so this cannot regress silently.
  splitting: true,
  // Every framework is an optional peer dependency — never bundled.
  external: ['express', 'fastify', 'hono', 'react'],
});
