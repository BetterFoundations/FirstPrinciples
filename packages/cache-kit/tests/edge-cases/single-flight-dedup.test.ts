import { describe, expect, it, vi } from 'vitest';
import { createCache } from '../../src/client.js';
import { createMemoryBackend } from '../../src/backends/memory.js';
import { createRedisBackend } from '../../src/backends/redis.js';
import { createFakeRedisClient } from '../helpers/fake-redis-client.js';
import type { CacheBackend } from '../../src/types.js';

/**
 * The test the S11 brief calls out as the one that actually matters:
 * N simultaneous misses for the same key must produce EXACTLY ONE
 * upstream call. Run against both backends — single-flight dedup lives
 * in `createCache`, above the backend, so it must behave identically no
 * matter which one is underneath.
 */
describe.each<[string, () => CacheBackend]>([
  ['memory backend', () => createMemoryBackend()],
  ['redis backend (fake client)', () => createRedisBackend({ client: createFakeRedisClient() })],
])('wrap — single-flight dedup (%s)', (_label, makeBackend) => {
  it('20 concurrent misses for the same key call fetcher exactly once', async () => {
    const cache = createCache(makeBackend());
    let inFlightCount = 0;
    let maxConcurrentFetches = 0;
    const fetcher = vi.fn().mockImplementation(async () => {
      inFlightCount += 1;
      maxConcurrentFetches = Math.max(maxConcurrentFetches, inFlightCount);
      // Yield a few microtask/macrotask turns so overlapping `wrap` calls
      // genuinely interleave rather than happening to run sequentially —
      // a fetcher that resolves synchronously would make this test pass
      // even with a broken dedup implementation.
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlightCount -= 1;
      return 'the-value';
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => cache.wrap('shared-key', fetcher)),
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(maxConcurrentFetches).toBe(1);
    expect(results).toEqual(Array.from({ length: 20 }, () => 'the-value'));
  });

  it('every concurrent caller gets the identical rejection when fetcher fails', async () => {
    const cache = createCache(makeBackend());
    const boom = new Error('upstream failed');
    const fetcher = vi.fn().mockImplementation(() => Promise.reject(boom));

    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () => cache.wrap('shared-key', fetcher)),
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      expect((outcome as PromiseRejectedResult).reason).toBe(boom);
    }
  });

  it('different keys never dedupe against each other', async () => {
    const cache = createCache(makeBackend());
    const fetcher = vi.fn().mockImplementation((key: string) => Promise.resolve(`value-${key}`));

    const [a, b] = await Promise.all([
      cache.wrap('key-a', () => fetcher('key-a')),
      cache.wrap('key-b', () => fetcher('key-b')),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(a).toBe('value-key-a');
    expect(b).toBe('value-key-b');
  });

  it('a fresh wrap call after the in-flight one settles triggers a new fetch, not a stale dedup', async () => {
    const cache = createCache(makeBackend());
    let calls = 0;
    const fetcher = vi.fn().mockImplementation(() => {
      calls += 1;
      return Promise.resolve(`call-${calls}`);
    });

    // Bypasses the cache write so the second wrap() genuinely misses
    // again rather than hitting the value the first call stored.
    const first = await cache.wrap('key', fetcher);
    await cache.invalidate('key');
    const second = await cache.wrap('key', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(first).toBe('call-1');
    expect(second).toBe('call-2');
  });
});
