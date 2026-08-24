import { CacheBackendError } from './errors.js';
import type { Cache, CacheBackend, CacheGetResult, SetOptions, WrapOptions } from './types.js';

/** Runs `promise`, turning a {@link CacheBackendError} into `undefined` instead of letting it propagate. */
async function swallowBackendError<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof CacheBackendError) return undefined;
    throw error;
  }
}

/**
 * Builds a {@link Cache} over any {@link CacheBackend} — the in-memory
 * one from {@link createMemoryBackend}, the Redis one from
 * {@link createRedisBackend}, or a custom backend implementing the same
 * interface. Cache-stampede protection lives entirely here, in `wrap`,
 * so it applies identically no matter which backend is underneath.
 *
 * @public
 */
export function createCache(backend: CacheBackend): Cache {
  // Keyed by cache key, holding the in-flight `wrap` promise for that
  // key. See `wrap` below for why the check-then-register sequence
  // around this map is race-free despite `wrap` itself being async.
  const inFlight = new Map<string, Promise<unknown>>();

  /**
   * Runs `fetcher` exactly once and stores its result, regardless of how
   * many callers are waiting on the returned promise. Deliberately not
   * `async` itself: an `async` function only starts running its body
   * (including the synchronous part before its first internal `await`)
   * when *called*, but the promise it returns is still handed back to
   * the caller synchronously — which is what lets `wrap` register this
   * promise in `inFlight` in the same synchronous stretch that checked
   * it was empty.
   */
  function runFetcherOnce<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: WrapOptions | undefined,
  ): Promise<T> {
    return (async () => {
      try {
        const value = await fetcher();
        await swallowBackendError(backend.set(key, value, options));
        return value;
      } finally {
        inFlight.delete(key);
      }
    })();
  }

  return {
    get<T>(key: string): Promise<CacheGetResult<T>> {
      return backend.get<T>(key);
    },

    set<T>(key: string, value: T, options?: SetOptions): Promise<void> {
      return backend.set(key, value, options);
    },

    invalidate(key: string): Promise<void> {
      return backend.delete(key);
    },

    invalidateTag(tag: string): Promise<void> {
      return backend.invalidateTag(tag);
    },

    async wrap<T>(key: string, fetcher: () => Promise<T>, options?: WrapOptions): Promise<T> {
      const cached = await swallowBackendError(backend.get<T>(key));
      if (cached?.hit) return cached.value;

      const existing = inFlight.get(key);
      if (existing !== undefined) return existing as Promise<T>;

      // From here to `inFlight.set` below is one uninterrupted
      // synchronous stretch — no `await` in between. That's the whole
      // mechanism behind "N simultaneous misses for the same key produce
      // exactly one upstream call": two concurrent `wrap` calls can both
      // reach this point (their `backend.get` calls above ran
      // concurrently), but whichever one's continuation the JS runtime
      // resumes first runs this entire block to completion — including
      // registering `promise` in `inFlight` — before the other's
      // continuation gets a turn. That second caller's own `inFlight.get`
      // check therefore always sees what the first one wrote; there is no
      // window where both observe an empty map and both start a fetch.
      const promise = runFetcherOnce(key, fetcher, options);
      inFlight.set(key, promise);
      return promise;
    },
  };
}
