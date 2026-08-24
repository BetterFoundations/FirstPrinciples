/**
 * `@firstprinciples/cache-kit` — a typed, backend-agnostic caching
 * layer: `get`/`set`/`wrap`/`invalidate` over an in-memory LRU or Redis,
 * interchangeable behind one {@link CacheBackend} interface, with
 * tag-based invalidation and single-flight cache-stampede protection.
 *
 * @example Read-through caching with stampede protection
 * ```ts
 * import { createCache, createMemoryBackend } from '@firstprinciples/cache-kit';
 *
 * const cache = createCache(createMemoryBackend({ maxEntries: 1000 }));
 *
 * // However many callers call this concurrently for the same id,
 * // fetchUser runs at most once.
 * const user = await cache.wrap(
 *   `user:${id}`,
 *   () => fetchUser(id),
 *   { ttlMs: 60_000, tags: ['users'] },
 * );
 *
 * // Later, invalidate every cached user at once:
 * await cache.invalidateTag('users');
 * ```
 *
 * @example Redis backend
 * ```ts
 * import { createCache, createRedisBackend } from '@firstprinciples/cache-kit';
 * import Redis from 'ioredis';
 *
 * const cache = createCache(createRedisBackend({ client: new Redis() }));
 * ```
 *
 * @packageDocumentation
 */

export { createCache } from './client.js';
export { CacheBackendError } from './errors.js';
export type { Cache, CacheBackend, CacheGetResult, SetOptions, WrapOptions } from './types.js';

export { createMemoryBackend } from './backends/memory.js';
export type { MemoryBackendOptions } from './backends/memory.js';

export { createRedisBackend } from './backends/redis.js';
export type { RedisBackendOptions, RedisClientLike, RedisPipelineLike } from './backends/redis.js';
