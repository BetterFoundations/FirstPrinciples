import { defineConfig } from 'tsup';

export default defineConfig({
  // Four independent entries, not one: `index` is framework-free, and each
  // adapter is its own subpath (`./express`, `./fastify`, `./hono`) so a
  // consumer importing one never pulls the other two frameworks' code into
  // their bundle — verified in `tests/integration/dist-bundle.test.ts`.
  entry: {
    index: 'src/index.ts',
    express: 'src/express.ts',
    fastify: 'src/fastify.ts',
    hono: 'src/hono.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  // Every framework is an optional peer dependency — never bundled.
  external: ['express', 'fastify', 'hono'],
});
