import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCache } from '../../src/client.js';
import { createRedisBackend } from '../../src/backends/redis.js';
import { isDockerAvailable } from '../helpers/docker-available.js';

/**
 * The real-Redis half of this package's Definition of Done: everything
 * elsewhere in this suite proves `createRedisBackend`'s own logic
 * against a fake client; this file proves that logic actually holds
 * against real Redis semantics — real `SET PX`/`SADD`/`SMEMBERS`/`SREM`,
 * a real network round trip, and a real dropped connection. Skipped
 * automatically when no Docker daemon is reachable (a local machine
 * without Docker, for instance) rather than hanging or failing — see
 * `isDockerAvailable`. GitHub Actions' `ubuntu-latest` runner has Docker
 * preinstalled, so this always runs there.
 */
describe.skipIf(!isDockerAvailable())(
  'Redis backend against a real, ephemeral Redis (testcontainers)',
  () => {
    let container: StartedRedisContainer;
    let client: Redis;

    beforeAll(async () => {
      container = await new RedisContainer('redis:7-alpine').start();
      client = new Redis(container.getConnectionUrl(), {
        // Fails fast instead of queueing/retrying for a long time once
        // the connection-loss test below stops the container — without
        // this, that test would hang rather than observing a failure.
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      });
    }, 120_000);

    afterAll(async () => {
      try {
        client?.disconnect();
      } catch {
        // already disconnected
      }
      try {
        await container?.stop();
      } catch {
        // already stopped, by the connection-loss test below
      }
    });

    it('round-trips a value through get/set', async () => {
      const backend = createRedisBackend({ client });
      await backend.set('smoke:a', { hello: 'world' });
      expect(await backend.get('smoke:a')).toEqual({ hit: true, value: { hello: 'world' } });
    });

    it('a miss is a miss, against a real empty keyspace', async () => {
      const backend = createRedisBackend({ client });
      expect(await backend.get('smoke:never-set')).toEqual({ hit: false });
    });

    it('a real TTL actually expires', async () => {
      const backend = createRedisBackend({ client });
      await backend.set('smoke:ttl', 'v', { ttlMs: 50 });
      expect(await backend.get('smoke:ttl')).toEqual({ hit: true, value: 'v' });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await backend.get('smoke:ttl')).toEqual({ hit: false });
    });

    it('tag invalidation correctness: removes every tagged key, leaves others alone', async () => {
      const cache = createCache(createRedisBackend({ client }));
      await cache.set('smoke:user:1', 'Ada', { tags: ['smoke-users'] });
      await cache.set('smoke:user:2', 'Grace', { tags: ['smoke-users'] });
      await cache.set('smoke:post:1', 'unrelated', { tags: ['smoke-posts'] });

      await cache.invalidateTag('smoke-users');

      expect(await cache.get('smoke:user:1')).toEqual({ hit: false });
      expect(await cache.get('smoke:user:2')).toEqual({ hit: false });
      expect(await cache.get('smoke:post:1')).toEqual({ hit: true, value: 'unrelated' });
    });

    it('cache-stampede protection: 15 concurrent misses against a real Redis-backed cache call fetcher exactly once', async () => {
      const cache = createCache(createRedisBackend({ client }));
      const fetcher = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return 'origin-value';
      });

      const results = await Promise.all(
        Array.from({ length: 15 }, () => cache.wrap('smoke:stampede-key', fetcher)),
      );

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(results.every((value) => value === 'origin-value')).toBe(true);
    });

    describe('connection loss mid-operation', () => {
      it('stopping the container makes the backend throw CacheBackendError, and wrap falls through cleanly instead', async () => {
        // Runs last: stops the shared container, so nothing after this
        // test in this file may depend on it still being up.
        const backend = createRedisBackend({ client });
        const cache = createCache(backend);

        await container.stop();

        await expect(backend.get('smoke:a')).rejects.toMatchObject({
          code: 'CACHE_BACKEND_ERROR',
        });

        const fetcher = vi.fn().mockResolvedValue('origin-despite-outage');
        await expect(cache.wrap('smoke:a', fetcher)).resolves.toBe('origin-despite-outage');
        expect(fetcher).toHaveBeenCalledTimes(1);
      }, 30_000);
    });
  },
);
