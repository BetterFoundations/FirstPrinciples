import { CacheBackendError } from '../errors.js';
import type { CacheBackend, CacheGetResult, SetOptions } from '../types.js';

/**
 * The chainable pipeline surface this backend needs, structurally
 * compatible with `ioredis`'s `pipeline()`/`multi()` return type.
 *
 * @public
 */
export interface RedisPipelineLike {
  set(key: string, value: string): this;
  set(key: string, value: string, mode: 'PX', duration: number): this;
  del(...keys: string[]): this;
  sadd(key: string, ...members: string[]): this;
  srem(key: string, ...members: string[]): this;
  pexpire(key: string, milliseconds: number): this;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

/**
 * The minimal command surface {@link createRedisBackend} needs from a
 * Redis client, structurally compatible with a real `ioredis` instance —
 * pass one straight in, no adapter required. Deliberately not `ioredis`
 * itself: this package never imports it, so an in-memory-only consumer
 * never pays for it, and the shape stays open to any client (a hand
 * rolled fake in tests, a different library with a compatible surface)
 * that happens to satisfy it.
 *
 * @public
 */
export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<'OK' | null>;
  set(key: string, value: string, mode: 'PX', duration: number): Promise<'OK' | null>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  pipeline(): RedisPipelineLike;
}

/**
 * Options for {@link createRedisBackend}.
 *
 * @public
 */
export interface RedisBackendOptions {
  /**
   * An already-connected client. This backend never constructs or owns a
   * connection — connection lifecycle (reconnect policy, TLS, auth) is
   * the caller's concern, not this package's.
   */
  readonly client: RedisClientLike;
  /**
   * Prefix applied to every Redis key this backend writes, so one Redis
   * instance can safely host more than one cache-kit consumer without
   * key collisions.
   *
   * @defaultValue `''`
   */
  readonly keyPrefix?: string;
}

const VALUE_PREFIX = 'v:';
const TAG_PREFIX = 't:';
const KEY_TAGS_PREFIX = 'kt:';

function wrapRedisError(operation: string, cause: unknown): CacheBackendError {
  return new CacheBackendError(`Redis ${operation} failed`, { cause });
}

function assertPipelineOk(results: Array<[Error | null, unknown]> | null, operation: string): void {
  if (results === null) {
    throw new CacheBackendError(`Redis pipeline for ${operation} returned no results`);
  }
  for (const [error] of results) {
    if (error !== null) throw wrapRedisError(operation, error);
  }
}

/**
 * A Redis-backed {@link CacheBackend}.
 *
 * @remarks
 * **Tag bookkeeping is bidirectional and kept clean on every write.**
 * Each tagged key stores its own current tag list (`kt:<key>`, a Redis
 * set) alongside the usual `t:<tag>` → member-keys set. Re-`set`ting a
 * key first reads that reverse index to `SREM` it from any tag it no
 * longer carries, and `delete`/`invalidateTag` do the same in the other
 * direction — removing a key also `SREM`s it from every tag it belonged
 * to, not just the one being invalidated. Skipping this and only ever
 * adding to `t:<tag>` sets would leave `invalidateTag` deleting keys
 * that were re-tagged away, or `SMEMBERS` returning already-gone keys
 * forever.
 *
 * **One accepted gap:** a key that expires via its own Redis TTL
 * (rather than through `delete`/`invalidateTag`) is not proactively
 * removed from `t:<tag>` or `kt:<key>` — Redis has no hook back into
 * this backend when that happens. The practical effect is bounded and
 * harmless: `invalidateTag` may `DEL` an already-gone key (a no-op), and
 * `kt:<key>` carries the same TTL as the value itself (see `pexpire`
 * below) so it self-cleans on the same schedule. Only `t:<tag>` sets can
 * accumulate stale members between invalidations of that tag — the
 * standard trade-off tag-based Redis caches make rather than paying for
 * keyspace-notification-driven cleanup.
 *
 * @public
 */
export function createRedisBackend(options: RedisBackendOptions): CacheBackend {
  const { client } = options;
  const prefix = options.keyPrefix ?? '';
  const valueKey = (key: string): string => `${prefix}${VALUE_PREFIX}${key}`;
  const tagKey = (tag: string): string => `${prefix}${TAG_PREFIX}${tag}`;
  const keyTagsKey = (key: string): string => `${prefix}${KEY_TAGS_PREFIX}${key}`;

  async function currentTagsOf(key: string): Promise<string[]> {
    try {
      return await client.smembers(keyTagsKey(key));
    } catch (cause) {
      throw wrapRedisError('SMEMBERS', cause);
    }
  }

  return {
    async get<T>(key: string): Promise<CacheGetResult<T>> {
      let raw: string | null;
      try {
        raw = await client.get(valueKey(key));
      } catch (cause) {
        throw wrapRedisError('GET', cause);
      }
      if (raw === null) return { hit: false };
      try {
        return { hit: true, value: JSON.parse(raw) as T };
      } catch (cause) {
        throw new CacheBackendError('Stored cache value failed to deserialize', {
          code: 'CACHE_CORRUPT_VALUE',
          cause,
        });
      }
    },

    async set<T>(key: string, value: T, setOptions: SetOptions = {}): Promise<void> {
      const tags = setOptions.tags ?? [];
      const previousTags = await currentTagsOf(key);
      const serialized = JSON.stringify(value);

      try {
        const pipeline = client.pipeline();
        for (const oldTag of previousTags) {
          if (!tags.includes(oldTag)) pipeline.srem(tagKey(oldTag), key);
        }
        if (setOptions.ttlMs === undefined) {
          pipeline.set(valueKey(key), serialized);
        } else {
          pipeline.set(valueKey(key), serialized, 'PX', setOptions.ttlMs);
        }
        pipeline.del(keyTagsKey(key));
        if (tags.length > 0) {
          pipeline.sadd(keyTagsKey(key), ...tags);
          for (const tag of tags) pipeline.sadd(tagKey(tag), key);
          // Keeps the reverse index from outliving the value it describes.
          if (setOptions.ttlMs !== undefined) pipeline.pexpire(keyTagsKey(key), setOptions.ttlMs);
        }
        assertPipelineOk(await pipeline.exec(), 'SET');
      } catch (cause) {
        if (cause instanceof CacheBackendError) throw cause;
        throw wrapRedisError('SET', cause);
      }
    },

    async delete(key: string): Promise<void> {
      const previousTags = await currentTagsOf(key);
      try {
        const pipeline = client.pipeline();
        pipeline.del(valueKey(key));
        pipeline.del(keyTagsKey(key));
        for (const tag of previousTags) pipeline.srem(tagKey(tag), key);
        assertPipelineOk(await pipeline.exec(), 'DEL');
      } catch (cause) {
        if (cause instanceof CacheBackendError) throw cause;
        throw wrapRedisError('DEL', cause);
      }
    },

    async invalidateTag(tag: string): Promise<void> {
      let members: string[];
      try {
        members = await client.smembers(tagKey(tag));
      } catch (cause) {
        throw wrapRedisError('SMEMBERS', cause);
      }
      if (members.length === 0) return;

      let memberTagLists: string[][];
      try {
        memberTagLists = await Promise.all(members.map((key) => client.smembers(keyTagsKey(key))));
      } catch (cause) {
        throw wrapRedisError('SMEMBERS', cause);
      }

      try {
        const pipeline = client.pipeline();
        members.forEach((key, index) => {
          pipeline.del(valueKey(key));
          pipeline.del(keyTagsKey(key));
          // Cleans the key out of every tag it belonged to, not just
          // this one — see the "bidirectional" note in this function's
          // docs. `index` is `Array.prototype.forEach`'s own loop
          // counter, not attacker-controlled input, so there is no
          // injection sink here.
          // eslint-disable-next-line security/detect-object-injection
          for (const memberTag of memberTagLists[index] ?? []) {
            pipeline.srem(tagKey(memberTag), key);
          }
        });
        pipeline.del(tagKey(tag));
        assertPipelineOk(await pipeline.exec(), 'invalidateTag');
      } catch (cause) {
        if (cause instanceof CacheBackendError) throw cause;
        throw wrapRedisError('invalidateTag', cause);
      }
    },
  };
}
