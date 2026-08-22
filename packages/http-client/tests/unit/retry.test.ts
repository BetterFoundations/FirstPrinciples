import { NotFoundError } from '@firstprinciples/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeBackoffMs,
  defaultRetryOn,
  executeWithRetry,
  resolveRetryConfig,
} from '../../src/internal/retry.js';
import type { ApiErr, ApiResult } from '../../src/types.js';

function networkFailure(): ApiErr {
  return { ok: false, error: new NotFoundError('unreachable'), status: undefined, kind: 'network' };
}

function httpFailure(status: number): ApiErr {
  return { ok: false, error: new NotFoundError('x', { httpStatus: status }), status, kind: 'http' };
}

function validationFailure(): ApiErr {
  return { ok: false, error: new NotFoundError('bad shape'), status: 200, kind: 'validation' };
}

describe('defaultRetryOn', () => {
  it('retries a network failure', () => {
    expect(defaultRetryOn(networkFailure())).toBe(true);
  });

  it('retries a 5xx response', () => {
    expect(defaultRetryOn(httpFailure(500))).toBe(true);
    expect(defaultRetryOn(httpFailure(503))).toBe(true);
  });

  it('never retries a 4xx response', () => {
    expect(defaultRetryOn(httpFailure(400))).toBe(false);
    expect(defaultRetryOn(httpFailure(404))).toBe(false);
    expect(defaultRetryOn(httpFailure(429))).toBe(false);
  });

  it('never retries a validation failure', () => {
    expect(defaultRetryOn(validationFailure())).toBe(false);
  });
});

describe('resolveRetryConfig', () => {
  it('applies documented defaults with no override', () => {
    const resolved = resolveRetryConfig(undefined);
    expect(resolved.attempts).toBe(2);
    expect(resolved.backoffMs).toBe(200);
    expect(resolved.retryOn).toBe(defaultRetryOn);
  });

  it('disables retries entirely when given false', () => {
    const resolved = resolveRetryConfig(false);
    expect(resolved.attempts).toBe(1);
    expect(resolved.retryOn(networkFailure())).toBe(false);
  });

  it('lets a partial override win over the base for just the fields it sets', () => {
    const base = resolveRetryConfig({ attempts: 5, backoffMs: 100 });
    const resolved = resolveRetryConfig({ attempts: 3 }, base);
    expect(resolved.attempts).toBe(3);
    expect(resolved.backoffMs).toBe(100);
  });

  it('falls back to the base config when no override is given at all', () => {
    const base = resolveRetryConfig({ attempts: 7 });
    expect(resolveRetryConfig(undefined, base)).toEqual(base);
  });
});

describe('computeBackoffMs', () => {
  it('draws uniformly from [0, backoffMs * 2^attemptIndex] (full jitter)', () => {
    const randomSpy = vi.spyOn(Math, 'random');

    randomSpy.mockReturnValue(0);
    expect(computeBackoffMs(0, 200)).toBe(0);
    expect(computeBackoffMs(3, 200)).toBe(0);

    randomSpy.mockReturnValue(1);
    expect(computeBackoffMs(0, 200)).toBe(200);
    expect(computeBackoffMs(1, 200)).toBe(400);
    expect(computeBackoffMs(2, 200)).toBe(800);

    randomSpy.mockReturnValue(0.5);
    expect(computeBackoffMs(0, 200)).toBe(100);

    randomSpy.mockRestore();
  });
});

describe('executeWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns immediately on a first-try success, never calling attempt again', async () => {
    const attempt = vi.fn<() => Promise<ApiResult<number>>>().mockResolvedValue({
      ok: true,
      value: 1,
      status: 200,
    });

    const result = await executeWithRetry(attempt, resolveRetryConfig({}));

    expect(result).toEqual({ ok: true, value: 1, status: 200 });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries up to `attempts` times, waiting a backoff between each', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const attempt = vi
      .fn<() => Promise<ApiResult<number>>>()
      .mockResolvedValueOnce(networkFailure() as ApiResult<number>)
      .mockResolvedValueOnce(networkFailure() as ApiResult<number>)
      .mockResolvedValueOnce({ ok: true, value: 42, status: 200 });

    const config = resolveRetryConfig({ attempts: 3, backoffMs: 200 });
    const promise = executeWithRetry(attempt, config);

    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);

    // Full jitter with Math.random() = 1 makes attempt 0's backoff exactly
    // backoffMs * 2^0 = 200ms.
    await vi.advanceTimersByTimeAsync(199);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);

    // Attempt 1's backoff is backoffMs * 2^1 = 400ms.
    await vi.advanceTimersByTimeAsync(399);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(3);

    const result = await promise;
    expect(result).toEqual({ ok: true, value: 42, status: 200 });
  });

  it('stops retrying and returns the last failure once `attempts` is exhausted', async () => {
    const attempt = vi
      .fn<() => Promise<ApiResult<number>>>()
      .mockResolvedValue(networkFailure() as ApiResult<number>);

    const promise = executeWithRetry(attempt, resolveRetryConfig({ attempts: 3, backoffMs: 1 }));
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('stops retrying as soon as retryOn says no, even with attempts left', async () => {
    const attempt = vi
      .fn<() => Promise<ApiResult<number>>>()
      .mockResolvedValue(httpFailure(404) as ApiResult<number>);

    const promise = executeWithRetry(attempt, resolveRetryConfig({ attempts: 5, backoffMs: 1 }));
    await vi.runAllTimersAsync();
    await promise;

    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('never calls attempt more than once when attempts is 1', async () => {
    const attempt = vi
      .fn<() => Promise<ApiResult<number>>>()
      .mockResolvedValue(networkFailure() as ApiResult<number>);

    await executeWithRetry(attempt, resolveRetryConfig(false));

    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
