import type { NetworkError } from '@firstprinciples/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';

/**
 * A fetch stand-in that behaves like the real thing with respect to
 * `signal`: it never settles on its own, and rejects with `signal.reason`
 * the moment the signal aborts. Lets these tests prove the timeout/abort
 * composition without a real network call or a real clock.
 */
function hangingAbortAwareFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn((_url: string, init: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Item 2 of this package's brief: a caller-supplied signal must be
// COMBINED with the internal timeout controller, aborting on whichever
// fires first. Letting the caller's signal replace the timeout is the bug
// these tests exist to catch — it would pass any test that never exercises
// the "caller signal present, but never aborted" path.
describe('caller signal composed with the internal timeout, not replacing it', () => {
  it('the internal timeout still fires when a caller signal is present but never aborts', async () => {
    hangingAbortAwareFetch();
    const callerController = new AbortController();
    const client = createApiClient({ baseUrl: 'https://api.example.com', timeoutMs: 1000 });

    const promise = client.get('/x', { signal: callerController.signal, retry: false });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.kind).toBe('network');
    expect((result.error as NetworkError).message).toContain('timed out');
    // The caller's own signal was never the one that fired.
    expect(callerController.signal.aborted).toBe(false);
  });

  it('a caller abort before the timeout wins, and does not wait for the timeout', async () => {
    hangingAbortAwareFetch();
    const callerController = new AbortController();
    const client = createApiClient({ baseUrl: 'https://api.example.com', timeoutMs: 5000 });

    const promise = client.get('/x', { signal: callerController.signal, retry: false });
    await vi.advanceTimersByTimeAsync(10);
    callerController.abort('user navigated away');
    const result = await promise;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.kind).toBe('network');
    expect((result.error as NetworkError).message).toContain('aborted');
  });

  it('a shorter timeout still wins over a caller signal that aborts later', async () => {
    hangingAbortAwareFetch();
    const callerController = new AbortController();
    const client = createApiClient({ baseUrl: 'https://api.example.com', timeoutMs: 100 });

    const promise = client.get('/x', { signal: callerController.signal, retry: false });
    await vi.advanceTimersByTimeAsync(100);
    callerController.abort('too late');
    const result = await promise;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect((result.error as NetworkError).message).toContain('timed out');
  });

  it('a per-call timeoutMs overrides the client default for this composition too', async () => {
    hangingAbortAwareFetch();
    const client = createApiClient({ baseUrl: 'https://api.example.com', timeoutMs: 10_000 });

    const promise = client.get('/x', { timeoutMs: 50, retry: false });
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result.ok).toBe(false);
  });
});
