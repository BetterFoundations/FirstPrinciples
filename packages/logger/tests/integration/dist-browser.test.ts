import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Checks the actual built browser bundle, rebuilt fresh (see the Node
 * counterpart for why). Two concerns: it behaves like the Node build
 * (minus AsyncLocalStorage's real isolation), and — the spec requirement
 * that's easy to silently regress — it never pulls in pino or a Node
 * built-in. A source-text scan of the built file is the only way to know
 * that for certain; a runtime "it didn't throw" check would not catch a
 * dependency that's merely unused at runtime but still bundled in.
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const esmPath = join(packageRoot, 'dist', 'browser.js');
const cjsPath = join(packageRoot, 'dist', 'browser.cjs');

type BrowserModule = typeof import('../../src/browser.js');

let esm: BrowserModule;
let cjs: BrowserModule;
let esmSource: string;
let cjsSource: string;

beforeAll(async () => {
  execFileSync('npx', ['tsup'], { cwd: packageRoot, stdio: 'inherit' });
  expect(existsSync(esmPath) && existsSync(cjsPath)).toBe(true);

  esmSource = readFileSync(esmPath, 'utf8');
  cjsSource = readFileSync(cjsPath, 'utf8');
  esm = (await import(esmPath)) as BrowserModule;
  cjs = createRequire(import.meta.url)(cjsPath) as BrowserModule;
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
});

const NODE_BUILTIN_MARKERS = [
  /require\(\s*['"]node:/,
  /from\s+['"]node:/,
  /require\(\s*['"]pino['"]\s*\)/,
  /from\s+['"]pino['"]/,
  /async_hooks/,
  /\bpino\(/,
];

describe.each([
  ['ESM', () => esmSource],
  ['CJS', () => cjsSource],
])('the built %s browser bundle', (_format, getSource) => {
  it('contains zero references to pino or a Node built-in', () => {
    const source = getSource();
    for (const marker of NODE_BUILTIN_MARKERS) {
      expect(source, `${marker} should not appear in the browser bundle`).not.toMatch(marker);
    }
  });
});

describe.each([
  ['ESM', () => esm],
  ['CJS', () => cjs],
])('the built %s browser module', (_format, get) => {
  it('produces a working logger that writes through console', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const build = get();
    build.createLogger({ name: 'app' }).info('hello', { userId: 1 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toContainEqual({ userId: 1 });
  });

  it('redacts before the console ever sees the value', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const build = get();
    build.createLogger().info('login', { password: 'hunter2' });
    expect(spy.mock.calls[0]).toContainEqual({ password: '[REDACTED]' });
  });
});

describe('the published browser surface', () => {
  it('exports the same public API shape as the Node entry', () => {
    expect(Object.keys(esm).sort()).toEqual([
      'createConsoleTransport',
      'createLogger',
      'generateCorrelationId',
      'getCorrelationId',
      'runWithCorrelationId',
    ]);
  });

  it('package.json wires the browser export condition and legacy browser field', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: { '.': { browser?: unknown } };
      browser?: Record<string, unknown>;
    };
    expect(manifest.exports['.'].browser).toBeDefined();
    expect(manifest.browser?.pino).toBe(false);
    expect(manifest.browser?.['node:async_hooks']).toBe(false);
  });
});
