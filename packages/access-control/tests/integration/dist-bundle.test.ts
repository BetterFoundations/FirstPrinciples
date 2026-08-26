import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Assertions about the built artifact rather than the source.
 *
 * Two things can only be checked here. First, that importing the engine
 * does not drag a framework in: the whole reason for five entry points
 * is that a browser importing `/react` never downloads Express, and no
 * amount of source-level testing can show that. Second, that both module
 * formats actually load — a `require()` of an ESM-only build fails at a
 * consumer's install, not in our tests.
 */

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const dist = join(packageRoot, 'dist');

function read(file: string): string {
  // Every `file` here is one of this suite's own hard-coded literals.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(join(dist, file), 'utf8');
}

beforeAll(() => {
  // This suite reads `dist/` rather than rebuilding it. `turbo.json`
  // already orders a package's `test` after its own `build`, and the
  // rebuild-inside-a-test pattern is what made `test` a *writer* of
  // `build`'s outputs — the race S13 spent a session tracking down. So:
  // assert the artifact is there, and say plainly what to run if it is
  // not, rather than quietly regenerating it under the reader's feet.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!existsSync(join(dist, 'index.js'))) {
    throw new Error(
      'dist/ is missing. Run `pnpm turbo run test` (which builds first) or `pnpm exec tsup` before `vitest run`.',
    );
  }
});

/**
 * Collects an entry's own source plus every shared chunk it reaches,
 * so an assertion about "what this entry pulls in" survives code
 * splitting instead of being quietly weakened by it.
 */
function sourcesReachableFrom(entry: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = read(file);
    out.push(source);
    for (const match of source.matchAll(/["'](\.\/chunk-[^"']+)["']/g)) {
      const chunk = match[1];
      if (chunk !== undefined) visit(chunk.replace('./', ''));
    }
  };
  visit(entry);
  return out;
}

/** Every module specifier an entry and its chunks import, chunks themselves excluded. */
function externalImportsOf(entry: string): string[] {
  const specifiers = sourcesReachableFrom(entry).flatMap((source) =>
    [...source.matchAll(/from ["']([^"']+)["']|require\(["']([^"']+)["']\)/g)].map(
      (match) => match[1] ?? match[2] ?? '',
    ),
  );
  return [...new Set(specifiers.filter((specifier) => !specifier.startsWith('./chunk-')))].sort();
}

describe('entry points stay independent', () => {
  it.each([
    ['index', ['express', 'fastify', 'hono', 'react']],
    ['react', ['express', 'fastify', 'hono']],
    ['express', ['fastify', 'hono', 'react']],
    ['fastify', ['express', 'hono', 'react']],
    ['hono', ['express', 'fastify', 'react']],
  ])('%s does not import %j', (entry, forbidden) => {
    const imports = externalImportsOf(`${entry}.js`);
    for (const module of forbidden) {
      expect(imports, `${entry}.js must not reference ${module}`).not.toContain(module);
    }
  });

  it('the engine has no framework imports at all', () => {
    expect(externalImportsOf('index.js')).toEqual(['@firstprinciples/core']);
  });

  it('a guard pulls in the engine but no framework runtime', () => {
    // The frameworks are type-only imports in the adapters, so they are
    // erased; the engine is a real runtime dependency, because the guard
    // is handed an AccessControl built by it.
    expect(externalImportsOf('express.js')).toEqual(['@firstprinciples/core']);
  });
});

describe('both module formats load', () => {
  it('the ESM build exports the public API', async () => {
    const module = (await import(join(dist, 'index.js'))) as Record<string, unknown>;
    expect(Object.keys(module).sort()).toEqual([
      'PermissionDeniedError',
      'createAccessControl',
      'definePolicy',
      'isPolicy',
      'owns',
      'parsePolicy',
    ]);
  });

  it('the CJS build exports the same names and actually decides', () => {
    const require_ = createRequire(import.meta.url);
    const module = require_(join(dist, 'index.cjs')) as typeof import('../../src/index.js');
    const policy = module.definePolicy({
      actions: ['read'],
      subjects: ['post'],
      rules: [{ effect: 'allow', actions: ['read'], subjects: ['post'] }],
    });
    expect(module.createAccessControl(policy).for(null).can('read', 'post')).toBe(true);
    expect(
      module
        .createAccessControl(policy)
        .for(null)
        .can('read', 'comment' as 'post'),
    ).toBe(false);
  });

  it('ships type declarations for every entry point', () => {
    for (const entry of ['index', 'react', 'express', 'fastify', 'hono']) {
      expect(read(`${entry}.d.ts`).length).toBeGreaterThan(0);
      expect(read(`${entry}.d.cts`).length).toBeGreaterThan(0);
    }
  });
});

describe('one class identity across every entry point', () => {
  /**
   * The regression test for a defect the source-level suites structurally
   * could not see.
   *
   * With each entry bundled independently, `dist/index.js` and
   * `dist/express.js` each defined their own `PermissionDeniedError`. A
   * consumer catching a guard's denial with
   * `error instanceof PermissionDeniedError` — the class imported from
   * the main entry, the error thrown by the guard — got `false`, and
   * every denial became a 500 instead of a 403. Every test that imports
   * through `src/` shares one module graph and so can never reproduce
   * it; only the built artifact can.
   */
  async function denialFrom(format: 'esm' | 'cjs'): Promise<{
    error: unknown;
    PermissionDeniedError: unknown;
  }> {
    const load = async (entry: string): Promise<Record<string, unknown>> =>
      format === 'esm'
        ? ((await import(join(dist, `${entry}.js`))) as Record<string, unknown>)
        : (createRequire(import.meta.url)(join(dist, `${entry}.cjs`)) as Record<string, unknown>);

    const index = await load('index');
    const expressEntry = await load('express');

    const definePolicy = index['definePolicy'] as (input: unknown) => unknown;
    const createAccessControl = index['createAccessControl'] as (policy: unknown) => unknown;
    const createExpressGuard = expressEntry['createExpressGuard'] as (
      ac: unknown,
      options: unknown,
    ) => (
      action: string,
      subject: string,
    ) => (req: unknown, res: unknown, next: (error?: unknown) => void) => void;

    const policy = definePolicy({ actions: ['read'], subjects: ['post'], rules: [] });
    const guard = createExpressGuard(createAccessControl(policy), { getPrincipal: () => null });

    const error = await new Promise<unknown>((resolve) => {
      guard('read', 'post')({}, { locals: {} }, resolve);
    });
    return { error, PermissionDeniedError: index['PermissionDeniedError'] };
  }

  it.each(['esm', 'cjs'] as const)(
    'a guard from the %s build throws the class the main entry exports',
    async (format) => {
      const { error, PermissionDeniedError } = await denialFrom(format);
      expect(error).toBeInstanceOf(PermissionDeniedError as new () => unknown);
      expect((error as { code: string }).code).toBe('PERMISSION_DENIED');
      expect((error as { httpStatus: number }).httpStatus).toBe(403);
    },
  );
});

describe('the shipped package declares only what it needs', () => {
  it('depends on core alone, with every framework optional', () => {
    // This package's own manifest, at a path derived from import.meta.url.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const manifestSource = readFileSync(join(packageRoot, 'package.json'), 'utf8');
    const manifest = JSON.parse(manifestSource) as {
      dependencies: Record<string, string>;
      peerDependencies: Record<string, string>;
      peerDependenciesMeta: Record<string, { optional: boolean }>;
    };
    expect(Object.keys(manifest.dependencies)).toEqual(['@firstprinciples/core']);
    for (const peer of Object.keys(manifest.peerDependencies)) {
      // Key taken from the very object being indexed.
      // eslint-disable-next-line security/detect-object-injection
      expect(manifest.peerDependenciesMeta[peer]?.optional).toBe(true);
    }
  });
});
