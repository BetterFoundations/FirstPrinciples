import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Everything else in this suite tests `src/`. This file tests what
 * actually ships: the bundled ESM and CJS artifacts.
 *
 * `class X extends Error` loses its prototype link when down-levelled to
 * ES5, which silently breaks `instanceof` across the whole hierarchy. Our
 * build targets ES2022 and esbuild emits native classes, so it does not —
 * but that is a property of the emitted output, not of the source, and
 * the only honest way to know is to load the output and check.
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const esmPath = join(packageRoot, 'dist', 'index.js');
const cjsPath = join(packageRoot, 'dist', 'index.cjs');

type CoreModule = typeof import('../../src/index.js');

let esm: CoreModule;
let cjs: CoreModule;

beforeAll(async () => {
  // Always rebuild. A dist left over from an earlier source revision
  // would let this suite pass while the artifact it claims to check no
  // longer matches `src/`.
  execFileSync('npx', ['tsup'], { cwd: packageRoot, stdio: 'inherit' });
  expect(existsSync(esmPath) && existsSync(cjsPath)).toBe(true);

  esm = (await import(esmPath)) as CoreModule;
  cjs = createRequire(import.meta.url)(cjsPath) as CoreModule;
}, 120_000);

describe.each([
  ['ESM', () => esm],
  ['CJS', () => cjs],
])('the built %s bundle', (_format, get) => {
  it('keeps instanceof working across the whole hierarchy', () => {
    const build = get();
    const error = new build.NotFoundError('gone');

    expect(error).toBeInstanceOf(build.NotFoundError);
    expect(error).toBeInstanceOf(build.AppError);
    expect(error).toBeInstanceOf(Error);
  });

  it('keeps class names through bundling, so toJSON stays stable', () => {
    const build = get();
    expect(new build.ConflictError('dup').toJSON()).toEqual({
      name: 'ConflictError',
      kind: 'ConflictError',
      message: 'dup',
      code: 'CONFLICT',
      httpStatus: 409,
    });
  });

  it('starts the stack at the throw site', () => {
    const build = get();
    const error = new build.ValidationError('bad');
    expect(error.stack?.split('\n')[0]).toBe('ValidationError: bad');
    expect(error.stack).not.toMatch(/at new (AppError|ValidationError)/);
  });
});

describe('the dual-package hazard', () => {
  it('is real: instanceof does not cross between the two builds', () => {
    const fromCjs = new cjs.NotFoundError('gone');
    expect(fromCjs).not.toBeInstanceOf(esm.AppError);
    expect(new esm.NotFoundError('gone')).not.toBeInstanceOf(cjs.AppError);
  });

  it('is what isAppError exists for, and it bridges both directions', () => {
    expect(esm.isAppError(new cjs.NotFoundError('gone'))).toBe(true);
    expect(cjs.isAppError(new esm.NotFoundError('gone'))).toBe(true);
  });

  it('lets an error serialized by one build be revived by the other', () => {
    const original = new cjs.ConflictError('dup', { code: 'EMAIL_TAKEN' });
    const revived = esm.AppError.fromJSON(JSON.parse(JSON.stringify(original)));

    expect(esm.isOk(revived)).toBe(true);
    if (!esm.isOk(revived)) return;
    expect(revived.value).toBeInstanceOf(esm.ConflictError);
    expect(revived.value.toJSON()).toEqual(original.toJSON());
  });
});

describe('the published surface', () => {
  it('exports exactly the intended public API', () => {
    expect(Object.keys(esm).sort()).toEqual([
      'AppError',
      'ConflictError',
      'ForbiddenError',
      'NetworkError',
      'NotFoundError',
      'UnauthorizedError',
      'ValidationError',
      'err',
      'isAppError',
      'isEmail',
      'isErr',
      'isISODateString',
      'isOk',
      'isUUID',
      'ok',
      'parseEmail',
      'parseISODateString',
      'parseUUID',
    ]);
  });

  it('ships with no runtime dependencies', async () => {
    const manifest = (await import(join(packageRoot, 'package.json'), {
      with: { type: 'json' },
    })) as { default: { dependencies?: unknown; peerDependencies?: unknown } };

    expect(manifest.default.dependencies).toBeUndefined();
    expect(manifest.default.peerDependencies).toBeUndefined();
  });
});
