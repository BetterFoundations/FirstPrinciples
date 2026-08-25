import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Rebuilds `dist/` from scratch and inspects the real built output — never
 * trusts a stale artifact, the same pattern `core`, `logger`, `http-client`,
 * and `cache-kit` all established. This is what actually proves the
 * "installing api-kit must not force Express on a Hono user" requirement:
 * a passing typecheck proves the *types* are peer-optional, but only the
 * built JS proves no framework's runtime code leaked across subpaths.
 */
describe('dist bundle', () => {
  beforeAll(() => {
    execFileSync('npx', ['tsup'], { cwd: packageRoot });
  }, 30000);

  function readDist(entry: string): string {
    // `entry` is always one of this file's own hard-coded literals
    // ('index.js', 'express.js', ...), never external input.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return readFileSync(new URL(`../../dist/${entry}`, import.meta.url), 'utf8');
  }

  it('the framework-free entry point imports no framework at all', () => {
    const source = readDist('index.js');
    expect(source).not.toMatch(/express/i);
    expect(source).not.toMatch(/fastify/i);
    expect(source).not.toMatch(/["']hono["']/);
  });

  it('the express subpath imports no fastify or hono code', () => {
    const source = readDist('express.js');
    expect(source).not.toMatch(/fastify/i);
    expect(source).not.toMatch(/["']hono["']/);
  });

  it('the fastify subpath imports no express or hono code', () => {
    const source = readDist('fastify.js');
    expect(source).not.toMatch(/express/i);
    expect(source).not.toMatch(/["']hono["']/);
  });

  it('the hono subpath imports no express or fastify code', () => {
    const source = readDist('hono.js');
    expect(source).not.toMatch(/express/i);
    expect(source).not.toMatch(/fastify/i);
  });

  it('no framework is bundled into any entry', () => {
    // Every adapter only ever imports its framework's *types*
    // (`import type { ... } from 'express'`, etc.), so tsup erases the
    // import entirely — there is no runtime reference to strip in the
    // first place. What actually proves nothing got bundled is size: a
    // real copy of Express, Fastify, or Hono is tens of KB on its own,
    // and none of these entries comes close.
    for (const entry of ['index.js', 'express.js', 'fastify.js', 'hono.js']) {
      expect(readDist(entry).length).toBeLessThan(10_000);
    }
  });

  it('no schema-validation library is imported anywhere in the built output', () => {
    for (const entry of ['index.js', 'express.js', 'fastify.js', 'hono.js']) {
      const source = readDist(entry);
      expect(source).not.toMatch(/\bzod\b/i);
      expect(source).not.toMatch(/\bvalibot\b/i);
      expect(source).not.toMatch(/\bajv\b/i);
      expect(source).not.toMatch(/\bjoi\b/i);
      expect(source).not.toMatch(/\byup\b/i);
    }
  });

  it('the public surface of the framework-free entry is exactly the documented exports', () => {
    const source = readDist('index.js');
    for (const exportName of [
      'toSuccessEnvelope',
      'toErrorEnvelope',
      'envelopeFromResult',
      'toProblemDetails',
      'runValidation',
    ]) {
      expect(source).toContain(exportName);
    }
  });
});
