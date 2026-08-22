import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(...impls: (Response | (() => Promise<Response>))[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const impl of impls) {
    if (impl instanceof Response) fn.mockResolvedValueOnce(impl);
    else fn.mockImplementationOnce(impl);
  }
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

// Item 3 of this package's brief: default retry policy is network errors
// and 5xx only — NEVER retry 4xx. Verified with fake timers so a wrongly
// "successful" test can't hide a real wait behind vitest's default
// timeout.
describe('default retry policy', () => {
  it('never retries a 400', async () => {
    const fetchMock = stubFetch(jsonResponse({ message: 'bad request' }, 400));
    const client = createApiClient({ baseUrl: 'https://api.example.com' });

    await client.get('/x');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries a 404, 409, or 429', async () => {
    for (const status of [404, 409, 429]) {
      const fetchMock = stubFetch(jsonResponse({}, status));
      const client = createApiClient({ baseUrl: 'https://api.example.com' });
      await client.get('/x');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('retries a 500, up to the default attempt count', async () => {
    const fetchMock = stubFetch(jsonResponse({}, 500), jsonResponse({ recovered: true }, 200));
    const client = createApiClient({ baseUrl: 'https://api.example.com' });

    const promise = client.get('/x');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true, value: { recovered: true }, status: 200 });
  });

  it('retries a network failure', async () => {
    const fetchMock = stubFetch(
      () => Promise.reject(new TypeError('ECONNRESET')),
      () => Promise.resolve(jsonResponse({ recovered: true })),
    );
    const client = createApiClient({ baseUrl: 'https://api.example.com' });

    const promise = client.get('/x');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it('exhausts attempts and returns the final failure rather than retrying forever', async () => {
    const fetchMock = stubFetch(
      jsonResponse({}, 503),
      jsonResponse({}, 503),
      jsonResponse({}, 503),
    );
    const client = createApiClient({ baseUrl: 'https://api.example.com', retry: { attempts: 2 } });

    const promise = client.get('/x');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
  });

  it('a per-call retry: false disables retries for just that call', async () => {
    const fetchMock = stubFetch(jsonResponse({}, 503));
    const client = createApiClient({ baseUrl: 'https://api.example.com' });

    await client.get('/x', { retry: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a per-call retryOn override replaces the default policy for that call', async () => {
    const fetchMock = stubFetch(jsonResponse({}, 400), jsonResponse({ ok: true }, 200));
    const client = createApiClient({ baseUrl: 'https://api.example.com' });

    const promise = client.get('/x', {
      retry: { attempts: 2, backoffMs: 1, retryOn: (failure) => failure.status === 400 },
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });
});

// Item 3 (continued): backoff timing itself, not just the retry/no-retry
// decision — verified with fake timers rather than asserted from reading
// the implementation.
describe('backoff timing', () => {
  it('waits before retrying rather than retrying immediately', async () => {
    // Full jitter draws from [0, backoffMs * 2^attempt]; pin Math.random
    // at its max so the wait is deterministically the full backoffMs.
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const fetchMock = stubFetch(jsonResponse({}, 500), jsonResponse({ ok: true }, 200));
    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      retry: { attempts: 2, backoffMs: 500 },
    });

    const promise = client.get('/x');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await promise;
    vi.restoreAllMocks();
  });
});
