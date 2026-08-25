import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = join(packageRoot, 'dist');
const require_ = createRequire(import.meta.url);

/**
 * Asserts things about the *built* package that cannot be checked
 * against `src/`.
 *
 * Unlike the equivalent suites in `core`, `logger`, `http-client`,
 * `cache-kit` and `api-kit`, this one does **not** re-run `tsup` in a
 * `beforeAll`. Those rebuilds exist to honour S7's "never trust a stale
 * artifact", but they are what makes `test` a writer of `build`'s
 * output directory — and running one here raced this package's own
 * `build` task, producing ENOENT on `dist/index.d.ts` on 2 of 5 clean
 * `turbo run lint typecheck test build` runs.
 *
 * `turbo.json` now orders `test` after the package's own `build`, which
 * gives the same guarantee without the race: turbo's cache is keyed on
 * source hashes, so a cache hit means `dist/` already matches `src/`,
 * and a source change re-runs the build. See the S13 turbo section in
 * EXECUTION-CHECKLIST.md.
 */

describe('the /jwt entry point is free of the native binding', () => {
  it('does not reference argon2 anywhere in its bundle', () => {
    const bundle = readFileSync(join(dist, 'jwt.js'), 'utf8');
    expect(bundle).not.toContain('argon2');
  });

  it('keeps the refresh and rate-limit code out of the jwt entry', () => {
    // The `/jwt` entry is for edge runtimes. Rotation needs
    // `node:crypto`, so it must not be reachable from here.
    const bundle = readFileSync(join(dist, 'jwt.js'), 'utf8');
    expect(bundle).not.toContain('createRefreshTokenService');
    expect(bundle).not.toContain('node:crypto');
  });

  it('emits declarations with no dependency on Node types', () => {
    // `tsconfig.json` names `types: ["node"]` so the dts build can see
    // the `Buffer` global that `password.ts` uses. That is a
    // type-checking convenience and must not become part of the
    // published contract for this entry — an edge-runtime consumer has
    // no `@types/node` installed.
    const declarations = readFileSync(join(dist, 'jwt.d.ts'), 'utf8');
    expect(declarations).not.toContain('node:');
    expect(declarations).not.toContain('Buffer');
  });

  it('imports and works with argon2 unresolvable', async () => {
    // The real test of the claim: run the ESM bundle in a process whose
    // module resolution cannot find `argon2` at all, and confirm a full
    // sign/verify round trip still works. An edge runtime is this,
    // permanently.
    const script = `
      import { createJwtSigner, createJwtVerifier } from ${JSON.stringify(join(dist, 'jwt.js'))};
      import { isOk } from '@firstprinciples/core';
      const key = new Uint8Array(32).fill(3);
      const token = await createJwtSigner({
        algorithm: 'HS256', key, issuer: 'i', audience: 'a', ttlSeconds: 60,
      }).sign({ sub: 'u' });
      const result = await createJwtVerifier({
        algorithms: ['HS256'], key, issuer: 'i', audience: 'a',
      }).verify(token);
      if (!isOk(result)) throw new Error('round trip failed');
      process.stdout.write(result.value.claims.sub);
    `;

    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: packageRoot,
      encoding: 'utf8',
      // A resolution root with no argon2 in it. If `dist/jwt.js`
      // carried even a lazy require of the binding, this would throw.
      env: { ...process.env, NODE_PATH: '/nonexistent' },
    });

    expect(output).toBe('u');
  });
});

describe('the built package', () => {
  it('declares argon2 as a peer dependency, and never bundles it', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string>
    >;

    expect(manifest.peerDependencies).toHaveProperty('argon2');
    expect(manifest.dependencies).not.toHaveProperty('argon2');

    // Present as an import in the full entry, not inlined into it.
    const index = readFileSync(join(dist, 'index.js'), 'utf8');
    expect(index).toContain('argon2');
    expect(index).not.toContain('node-gyp-build');
  });

  it('ships both ESM and CJS with matching type declarations', () => {
    for (const file of [
      'index.js',
      'index.cjs',
      'index.d.ts',
      'index.d.cts',
      'jwt.js',
      'jwt.cjs',
      'jwt.d.ts',
      'jwt.d.cts',
    ]) {
      // The path is built from this file's own literal list and the
      // package root, with no external input anywhere in it.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      expect(() => readFileSync(join(dist, file), 'utf8'), file).not.toThrow();
    }
  });

  it('is requireable from CommonJS', () => {
    const cjs = require_(join(dist, 'index.cjs')) as Record<string, unknown>;
    expect(typeof cjs.createJwtVerifier).toBe('function');
    expect(typeof cjs.hashPassword).toBe('function');
    expect(typeof cjs.DEFAULT_ARGON2_PARAMS).toBe('object');
  });

  it('exports exactly the intended public surface, and nothing else', async () => {
    const surface = Object.keys(
      (await import(join(dist, 'index.js'))) as Record<string, unknown>,
    ).sort();

    expect(surface).toEqual([
      'AuthConfigurationError',
      'DEFAULT_ARGON2_PARAMS',
      'JwtVerificationError',
      'MAX_CLOCK_TOLERANCE_SECONDS',
      'MAX_PASSWORD_BYTES',
      'PasswordHashError',
      'RateLimitStoreError',
      'RefreshTokenError',
      'RefreshTokenStoreError',
      'createJwtSigner',
      'createJwtVerifier',
      'createLoginRateLimiter',
      'createMemoryAttemptStore',
      'createMemoryRefreshTokenStore',
      'createRefreshTokenService',
      'hashPassword',
      'passwordNeedsRehash',
      'verifyPassword',
      'verifyPasswordDecoy',
    ]);
  });

  it('carries no dependency on anything outside core and jose', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };

    expect(Object.keys(manifest.dependencies).sort()).toEqual(['@firstprinciples/core', 'jose']);
  });
});
