import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Everything else in this suite tests `src/`. This file tests what
 * actually ships: the bundled artifact, rebuilt fresh so a stale `dist/`
 * left from an earlier revision can't fake a pass.
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const esmPath = join(packageRoot, 'dist', 'index.js');

type HttpClientModule = typeof import('../../src/index.js');
let esm: HttpClientModule;
let bundleSource: string;

beforeAll(async () => {
  execFileSync('npx', ['tsup'], { cwd: packageRoot, stdio: 'inherit' });
  expect(existsSync(esmPath)).toBe(true);

  bundleSource = readFileSync(esmPath, 'utf8');
  esm = (await import(esmPath)) as HttpClientModule;
}, 120_000);

describe('the built bundle', () => {
  it('fits the 3-5KB gzipped target the spec sets', () => {
    // A real measurement, not an assumption — this is the same claim
    // size-limit enforces in CI, checked here directly against the just
    // -built artifact. Gzip, not brotli (what size-limit measures) —
    // gzip is always the larger of the two, so this is a conservative
    // upper bound, not a looser one.
    const gzipped = gzipSync(bundleSource);
    expect(gzipped.byteLength).toBeLessThan(5 * 1024);
  });

  it('never references a validation library — the adapter is a slot, not a dependency', () => {
    // Item 4 of this package's brief: Zod/Valibot examples belong in docs,
    // never in the package. A regression here would mean someone imported
    // one directly instead of going through the ValidateFn slot.
    expect(bundleSource).not.toMatch(/\bzod\b/i);
    expect(bundleSource).not.toMatch(/\bvalibot\b/i);
  });

  it('exports exactly the intended public API', () => {
    expect(Object.keys(esm).sort()).toEqual(['createApiClient']);
  });

  it('depends on nothing but @firstprinciples/core at runtime', async () => {
    const manifest = (await import(join(packageRoot, 'package.json'), {
      with: { type: 'json' },
    })) as { default: { dependencies?: Record<string, string> } };

    expect(manifest.default.dependencies).toEqual({ '@firstprinciples/core': 'workspace:*' });
  });
});

describe('tree-shaking — importing only createApiClient', () => {
  it('a minimal consumer bundle builds cleanly, self-contained, at a small size', async () => {
    // src/index.ts exports nothing but createApiClient (plus types, erased
    // at compile time) — there is no unused adapter or extra surface for a
    // consumer to accidentally pull in, unlike a package that also ships a
    // Zod/Valibot adapter. What's left to verify is that a minimal consumer
    // still builds to something small and self-contained: no runaway size
    // from an unexpected transitive dependency, and no leftover reference
    // to a validation library even after bundling (not just in dist/'s own
    // source, which the earlier test already checks).
    const esbuild = await import('esbuild');
    const result = await esbuild.build({
      stdin: {
        contents: `import { createApiClient } from ${JSON.stringify(esmPath)}; createApiClient({ baseUrl: 'x' });`,
        resolveDir: packageRoot,
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      treeShaking: true,
      external: ['@firstprinciples/core'],
    });

    const output = result.outputFiles[0]?.text ?? '';
    expect(output).toContain('createApiClient');
    expect(output).not.toMatch(/\bzod\b/i);
    expect(output).not.toMatch(/\bvalibot\b/i);
    // Unminified source for this package's whole implementation is a few
    // KB; an unexpected 10x jump here would mean something unrelated got
    // swept in.
    expect(output.length).toBeLessThan(15 * 1024);
  });
});
