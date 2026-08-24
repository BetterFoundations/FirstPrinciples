import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Everything else in this suite tests `src/`. This file tests what
 * actually ships: the bundled artifact, rebuilt fresh so a stale `dist/`
 * left from an earlier revision can't fake a pass. Same pattern as
 * `core`'s `dist-interop` test and `http-client`'s `dist-bundle` test.
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const esmPath = join(packageRoot, 'dist', 'index.js');

type CacheKitModule = typeof import('../../src/index.js');
let esm: CacheKitModule;
let bundleSource: string;

beforeAll(async () => {
  execFileSync('npx', ['tsup'], { cwd: packageRoot, stdio: 'inherit' });
  expect(existsSync(esmPath)).toBe(true);

  bundleSource = readFileSync(esmPath, 'utf8');
  esm = (await import(esmPath)) as CacheKitModule;
}, 120_000);

describe('the built bundle', () => {
  it('fits under the 3KB gzipped budget', () => {
    const gzipped = gzipSync(bundleSource);
    expect(gzipped.byteLength).toBeLessThan(3 * 1024);
  });

  it('never imports ioredis or testcontainers — the Redis backend is structurally typed, not linked to a client library', () => {
    expect(bundleSource).not.toMatch(/\bioredis\b/i);
    expect(bundleSource).not.toMatch(/\btestcontainers\b/i);
  });

  it('exports exactly the intended public API', () => {
    expect(Object.keys(esm).sort()).toEqual(
      ['CacheBackendError', 'createCache', 'createMemoryBackend', 'createRedisBackend'].sort(),
    );
  });

  it('depends on nothing but @firstprinciples/core at runtime', async () => {
    const manifest = (await import(join(packageRoot, 'package.json'), {
      with: { type: 'json' },
    })) as { default: { dependencies?: Record<string, string> } };

    expect(manifest.default.dependencies).toEqual({ '@firstprinciples/core': 'workspace:*' });
  });
});

describe('tree-shaking — importing only createMemoryBackend', () => {
  it('a consumer that never touches Redis does not pull in the Redis backend module', async () => {
    const esbuild = await import('esbuild');
    const result = await esbuild.build({
      stdin: {
        contents: `import { createCache, createMemoryBackend } from ${JSON.stringify(esmPath)}; createCache(createMemoryBackend());`,
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
    expect(output).toContain('createMemoryBackend');
    // The Redis backend module's own identifiers should not survive
    // tree-shaking when nothing imports createRedisBackend.
    expect(output).not.toMatch(/createRedisBackend/);
    expect(output.length).toBeLessThan(10 * 1024);
  });
});
