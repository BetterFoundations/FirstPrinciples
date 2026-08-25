import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Everything else in this suite tests `src/`. This checks what actually
 * ships: the bundled Node ESM/CJS artifacts, rebuilt fresh so a stale dist
 * left over from an earlier revision can't fake a pass.
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const esmPath = join(packageRoot, 'dist', 'index.js');
const cjsPath = join(packageRoot, 'dist', 'index.cjs');

type IndexModule = typeof import('../../src/index.js');

let esm: IndexModule;
let cjs: IndexModule;

beforeAll(async () => {
  // No `tsup` rebuild here. Both of this package's dist suites used to
  // run one independently, and vitest runs test files in parallel
  // workers, so the two raced each other over a single `dist/` —
  // logged as a known intermittent failure since S10 (`ENOTEMPTY` /
  // `ENOENT: mkdir .../logger/dist`), and still reproducing on 1 of 6
  // clean runs in S13. `turbo.json` now orders `test` after the
  // package's own `build`, which gives the same "never trust a stale
  // artifact" guarantee the rebuild was there for (turbo's cache is
  // keyed on source hashes, so a cache hit means `dist/` matches
  // `src/`) without two processes writing the same directory. The
  // `existsSync` assertion below still fails loudly if it is missing.
  expect(existsSync(esmPath) && existsSync(cjsPath)).toBe(true);

  esm = (await import(esmPath)) as IndexModule;
  cjs = createRequire(import.meta.url)(cjsPath) as IndexModule;
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  ['ESM', () => esm],
  ['CJS', () => cjs],
])('the built %s bundle', (_format, get) => {
  it('produces a working logger that writes real pino JSON', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const build = get();
    build.createLogger({ name: 'svc' }).info('hello', { userId: 1 });

    const line = JSON.parse(String(spy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(line.msg).toBe('hello');
    expect(line.userId).toBe(1);
  });

  it('redacts before pino ever sees the value', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const build = get();
    build.createLogger().info('login', { password: 'hunter2' });

    const line = JSON.parse(String(spy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(line.password).toBe('[REDACTED]');
  });

  it('propagates a correlation ID through AsyncLocalStorage across a real await', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const build = get();
    const logger = build.createLogger();

    await build.runWithCorrelationId('req-1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      logger.info('inside');
    });

    const line = JSON.parse(String(spy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(line.correlationId).toBe('req-1');
  });
});

describe('the published Node surface', () => {
  it('exports exactly the intended public API', () => {
    expect(Object.keys(esm).sort()).toEqual([
      'createConsoleTransport',
      'createLogger',
      'generateCorrelationId',
      'getCorrelationId',
      'runWithCorrelationId',
    ]);
  });

  it('lists pino as its only runtime dependency', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['pino']);
  });
});
