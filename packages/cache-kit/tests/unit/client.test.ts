import { describe, expect, it, vi } from 'vitest';
import { createCache } from '../../src/client.js';
import { createMemoryBackend } from '../../src/backends/memory.js';
import { CacheBackendError } from '../../src/errors.js';

describe('createCache — get/set/invalidate delegate straight to the backend', () => {
  it('get/set round-trip through the backend', async () => {
    const cache = createCache(createMemoryBackend());
    await cache.set('a', 42);
    expect(await cache.get('a')).toEqual({ hit: true, value: 42 });
  });

  it('invalidate removes a key', async () => {
    const cache = createCache(createMemoryBackend());
    await cache.set('a', 42);
    await cache.invalidate('a');
    expect(await cache.get('a')).toEqual({ hit: false });
  });

  it('invalidateTag removes every key with that tag', async () => {
    const cache = createCache(createMemoryBackend());
    await cache.set('a', 1, { tags: ['x'] });
    await cache.set('b', 2, { tags: ['x'] });
    await cache.invalidateTag('x');
    expect(await cache.get('a')).toEqual({ hit: false });
    expect(await cache.get('b')).toEqual({ hit: false });
  });
});

describe('createCache — wrap', () => {
  it('calls fetcher on a miss and returns its value', async () => {
    const cache = createCache(createMemoryBackend());
    const fetcher = vi.fn().mockResolvedValue('fresh');
    expect(await cache.wrap('a', fetcher)).toBe('fresh');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not call fetcher on a hit', async () => {
    const cache = createCache(createMemoryBackend());
    await cache.set('a', 'cached');
    const fetcher = vi.fn().mockResolvedValue('fresh');
    expect(await cache.wrap('a', fetcher)).toBe('cached');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stores the fetched value back in the cache', async () => {
    const cache = createCache(createMemoryBackend());
    await cache.wrap('a', () => Promise.resolve('fresh'));
    expect(await cache.get('a')).toEqual({ hit: true, value: 'fresh' });
  });

  it('forwards ttlMs/tags to the underlying set', async () => {
    const cache = createCache(createMemoryBackend());
    await cache.wrap('a', () => Promise.resolve('fresh'), { tags: ['x'] });
    await cache.invalidateTag('x');
    expect(await cache.get('a')).toEqual({ hit: false });
  });

  it('propagates a rejection from fetcher, unmodified', async () => {
    const cache = createCache(createMemoryBackend());
    const boom = new Error('upstream boom');
    await expect(cache.wrap('a', () => Promise.reject(boom))).rejects.toBe(boom);
  });

  it('does not leave a failed key permanently in-flight — a later wrap call retries', async () => {
    const cache = createCache(createMemoryBackend());
    let attempt = 0;
    const fetcher = vi.fn().mockImplementation(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error('first attempt fails'))
        : Promise.resolve('second attempt');
    });
    await expect(cache.wrap('a', fetcher)).rejects.toThrow('first attempt fails');
    expect(await cache.wrap('a', fetcher)).toBe('second attempt');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('a backend failure on the internal read never surfaces from wrap — it falls through to fetcher', async () => {
    const failingBackend = {
      get: vi.fn().mockRejectedValue(new CacheBackendError('down')),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
      invalidateTag: vi.fn(),
    };
    // Cast through unknown: this backend only needs to satisfy the shape
    // wrap() actually calls for this test.
    const cache = createCache(failingBackend as unknown as Parameters<typeof createCache>[0]);
    const fetcher = vi.fn().mockResolvedValue('fresh-despite-cache-outage');
    await expect(cache.wrap('a', fetcher)).resolves.toBe('fresh-despite-cache-outage');
  });

  it('a backend failure on the internal write never surfaces from wrap', async () => {
    const failingBackend = {
      get: vi.fn().mockResolvedValue({ hit: false }),
      set: vi.fn().mockRejectedValue(new CacheBackendError('down')),
      delete: vi.fn(),
      invalidateTag: vi.fn(),
    };
    const cache = createCache(failingBackend as unknown as Parameters<typeof createCache>[0]);
    await expect(cache.wrap('a', () => Promise.resolve('fresh'))).resolves.toBe('fresh');
  });

  it('a non-CacheBackendError from the backend is NOT swallowed by wrap — only cache-layer failures are fail-soft', async () => {
    const bug = new TypeError('this is a real bug, not a cache outage');
    const buggyBackend = {
      get: vi.fn().mockRejectedValue(bug),
      set: vi.fn(),
      delete: vi.fn(),
      invalidateTag: vi.fn(),
    };
    const cache = createCache(buggyBackend as unknown as Parameters<typeof createCache>[0]);
    await expect(cache.wrap('a', () => Promise.resolve('fresh'))).rejects.toBe(bug);
  });
});
