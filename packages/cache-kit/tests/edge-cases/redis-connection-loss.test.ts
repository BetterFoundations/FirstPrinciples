import { describe, expect, it, vi } from 'vitest';
import { createCache } from '../../src/client.js';
import { createRedisBackend } from '../../src/backends/redis.js';
import { createFakeRedisClient } from '../helpers/fake-redis-client.js';
import { CacheBackendError } from '../../src/errors.js';

/**
 * "Redis connection loss mid-operation" — one of the spec's named test
 * focuses. `redis-testcontainers.test.ts` is what proves this against a
 * real Redis instance (killed mid-suite); this file proves the two
 * distinct contracts around it using a client that can be told to drop
 * on command: the raw `CacheBackend` surfaces the failure, and
 * `Cache.wrap` never does.
 */
describe('Redis connection loss', () => {
  it('the raw backend throws CacheBackendError on every operation while the connection is down', async () => {
    const client = createFakeRedisClient();
    const backend = createRedisBackend({ client });

    await backend.set('a', 1); // succeeds before the outage
    client.setDown(true);

    await expect(backend.get('a')).rejects.toBeInstanceOf(CacheBackendError);
    await expect(backend.set('b', 2)).rejects.toBeInstanceOf(CacheBackendError);
    await expect(backend.delete('a')).rejects.toBeInstanceOf(CacheBackendError);
    await expect(backend.invalidateTag('t')).rejects.toBeInstanceOf(CacheBackendError);
  });

  it("cache.wrap falls through to fetcher when the connection drops mid-operation, never rejecting on the cache's behalf", async () => {
    const client = createFakeRedisClient();
    const cache = createCache(createRedisBackend({ client }));
    client.setDown(true);

    const fetcher = vi.fn().mockResolvedValue('fresh-from-origin');
    await expect(cache.wrap('a', fetcher)).resolves.toBe('fresh-from-origin');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('wrap keeps working across repeated calls for the whole outage, and the value is cached once the connection recovers', async () => {
    const client = createFakeRedisClient();
    const cache = createCache(createRedisBackend({ client }));
    const fetcher = vi.fn().mockResolvedValue('v');

    client.setDown(true);
    await cache.wrap('a', fetcher);
    await cache.wrap('a', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2); // never got cached during the outage, so every call re-fetches

    client.setDown(false);
    await cache.wrap('a', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3); // this call still misses (nothing was ever cached)...
    expect(await cache.get('a')).toEqual({ hit: true, value: 'v' }); // ...but now the write succeeded
  });

  it('a connection drop between the read and the write of one wrap() call still falls through cleanly', async () => {
    const client = createFakeRedisClient();
    const cache = createCache(createRedisBackend({ client }));

    const fetcher = vi.fn().mockImplementation(async () => {
      // The connection drops while the fetch itself is in flight — the
      // read that already happened succeeded, but the write-back after
      // this resolves will not.
      client.setDown(true);
      return 'v';
    });

    await expect(cache.wrap('a', fetcher)).resolves.toBe('v');
    client.setDown(false);
    // The write-back failed silently, so this is a genuine miss, not a
    // stale/partial write.
    expect(await cache.get('a')).toEqual({ hit: false });
  });
});
