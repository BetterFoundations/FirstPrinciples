import { afterEach, describe, expect, it, vi } from 'vitest';
import { runChecks } from '../../src/internal/checks.js';
import type { HealthCheck } from '../../src/index.js';

const pass = (name: string, extra: Partial<HealthCheck> = {}): HealthCheck => ({
  name,
  check: () => undefined,
  ...extra,
});
const fail = (name: string, extra: Partial<HealthCheck> = {}): HealthCheck => ({
  name,
  check: () => {
    throw new Error(`${name} is down`);
  },
  ...extra,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runChecks', () => {
  it('passes with no checks at all', async () => {
    expect(await runChecks([], 1000, 'running')).toEqual({
      status: 'pass',
      state: 'running',
      checks: {},
    });
  });

  it('treats undefined, true and a resolved promise as a pass', async () => {
    const report = await runChecks(
      [pass('a'), { name: 'b', check: () => true }, { name: 'c', check: async () => undefined }],
      1000,
      'running',
    );
    expect(report.status).toBe('pass');
    expect(Object.values(report.checks).map((c) => c.status)).toEqual(['pass', 'pass', 'pass']);
  });

  it('fails on a critical failure, and records why', async () => {
    const report = await runChecks([pass('a'), fail('db')], 1000, 'running');
    expect(report.status).toBe('fail');
    expect(report.checks.db).toMatchObject({ status: 'fail', critical: true, error: 'db is down' });
    expect(report.checks.a).not.toHaveProperty('error');
  });

  it('only warns on a non-critical failure', async () => {
    const report = await runChecks(
      [pass('a'), fail('cache', { critical: false })],
      1000,
      'running',
    );
    expect(report.status).toBe('warn');
    expect(report.checks.cache).toMatchObject({ status: 'fail', critical: false });
  });

  it('a critical failure outranks a non-critical one, in either order', async () => {
    expect(
      (await runChecks([fail('x', { critical: false }), fail('y')], 1000, 'running')).status,
    ).toBe('fail');
    expect(
      (await runChecks([fail('y'), fail('x', { critical: false })], 1000, 'running')).status,
    ).toBe('fail');
  });

  it('fails a check that returns false', async () => {
    const report = await runChecks([{ name: 'q', check: () => false }], 1000, 'running');
    expect(report.checks.q).toMatchObject({ status: 'fail', error: 'check returned false' });
  });

  it('fails a check that rejects asynchronously', async () => {
    const report = await runChecks(
      [{ name: 'q', check: () => Promise.reject(new Error('async boom')) }],
      1000,
      'running',
    );
    expect(report.checks.q?.error).toBe('async boom');
  });

  it('describes a non-Error throw', async () => {
    const report = await runChecks(
      [
        {
          name: 'str',
          check: () => {
            throw 'plain string';
          },
        },
        {
          name: 'obj',
          check: () => {
            throw { weird: true };
          },
        },
        {
          name: 'empty',
          check: () => {
            throw new Error('');
          },
        },
      ],
      1000,
      'running',
    );
    expect(report.checks.str?.error).toBe('plain string');
    expect(report.checks.obj?.error).toBe('check failed');
    expect(report.checks.empty?.error).toBe('check failed');
  });

  it('cuts off a hanging check at its timeout and aborts its signal', async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const pending = runChecks(
      [
        {
          name: 'slow',
          timeoutMs: 50,
          check: (signal) => {
            seen = signal;
            return new Promise(() => undefined);
          },
        },
        pass('fast'),
      ],
      5000,
      'running',
    );
    await vi.advanceTimersByTimeAsync(50);
    const report = await pending;
    expect(report.checks.slow).toMatchObject({ status: 'fail', error: 'timed out after 50ms' });
    expect(report.checks.fast?.status).toBe('pass');
    expect(seen?.aborted).toBe(true);
  });

  it('uses the default timeout when a check sets none', async () => {
    vi.useFakeTimers();
    const pending = runChecks(
      [{ name: 'slow', check: () => new Promise(() => undefined) }],
      200,
      'running',
    );
    await vi.advanceTimersByTimeAsync(199);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).checks.slow?.error).toBe('timed out after 200ms');
  });

  it('runs checks concurrently, not one after another', async () => {
    vi.useFakeTimers();
    const sleepy = (name: string): HealthCheck => ({
      name,
      check: () => new Promise((r) => setTimeout(r, 100)),
    });
    const pending = runChecks([sleepy('a'), sleepy('b'), sleepy('c')], 1000, 'running');
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).status).toBe('pass');
  });

  it('stores a check named __proto__ as a key', async () => {
    const report = await runChecks([pass('__proto__')], 1000, 'running');
    expect(Object.keys(report.checks)).toEqual(['__proto__']);
  });
});
