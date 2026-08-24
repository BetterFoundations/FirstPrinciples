/**
 * The outcome of a cache read: a hit carrying the stored value, or a
 * miss.
 *
 * @typeParam T - Type of the cached value.
 *
 * @remarks
 * Deliberately **not** layered on `@firstprinciples/core`'s `Result`,
 * unlike `@firstprinciples/http-client`'s `ApiResult`. A miss is not a
 * failure — it is the cache's single most common, fully expected outcome
 * on every cold read, unlike an HTTP 404 (a business fact about one
 * specific resource) or a validation failure (a caller input problem).
 * Forcing it through `Result`'s `Ok`/`Err` binary would mean treating
 * "miss" as an `Err` that every caller must handle as though something
 * went wrong, when nothing did. This is closer in spirit to `Map.get`
 * returning `T | undefined`, just spelled as a discriminated union so a
 * cached `undefined` value is still distinguishable from a miss.
 *
 * A genuine failure — the backend itself being unreachable — is a
 * different, actually-exceptional kind of outcome, and is not
 * represented here at all: it throws {@link CacheBackendError} instead.
 * See that class's docs for which methods throw it and which swallow it.
 *
 * @public
 */
export type CacheGetResult<T> = { readonly hit: true; readonly value: T } | { readonly hit: false };

/**
 * Options for {@link CacheBackend.set} and {@link Cache.set}.
 *
 * @public
 */
export interface SetOptions {
  /**
   * Time-to-live in milliseconds. An entry is considered expired once
   * `Date.now() >= writeTime + ttlMs` — so a 1000ms TTL is still a hit at
   * +999ms and a miss at +1000ms.
   *
   * @defaultValue No expiry. The entry lives until explicitly invalidated
   * or, on the in-memory backend only, evicted under capacity pressure.
   */
  readonly ttlMs?: number;
  /**
   * Tags this entry belongs to, for later bulk removal via
   * {@link Cache.invalidateTag}. Re-`set`ting the same key with a
   * different tag list (or none) fully replaces its previous tags —
   * both backends clean up the old tag memberships, so a stale
   * `invalidateTag` call can never remove a key that was re-tagged away.
   */
  readonly tags?: readonly string[];
}

/**
 * Options for {@link Cache.wrap}. Identical shape to {@link SetOptions}:
 * they control how `wrap` stores the value it fetches on a miss.
 *
 * @public
 */
export type WrapOptions = SetOptions;

/**
 * The storage contract both backends implement identically, so
 * {@link createCache} can drive either one without knowing which it has.
 *
 * @remarks
 * This is the low-level, backend-facing interface — it has no
 * cache-stampede protection of its own. That lives one layer up, in
 * {@link createCache}'s `wrap`, applied uniformly regardless of which
 * `CacheBackend` is underneath.
 *
 * @public
 */
export interface CacheBackend {
  /** Reads `key`. See {@link CacheGetResult}. Throws {@link CacheBackendError} on backend failure. */
  get<T>(key: string): Promise<CacheGetResult<T>>;
  /** Writes `key`, replacing any previous value and tags. Throws {@link CacheBackendError} on backend failure. */
  set<T>(key: string, value: T, options?: SetOptions): Promise<void>;
  /** Removes `key` and cleans up its tag memberships. A no-op if `key` is absent. Throws {@link CacheBackendError} on backend failure. */
  delete(key: string): Promise<void>;
  /** Removes every key currently tagged `tag`, and that tag's own bookkeeping. A no-op if nothing is tagged `tag`. Throws {@link CacheBackendError} on backend failure. */
  invalidateTag(tag: string): Promise<void>;
}

/**
 * The public cache client {@link createCache} returns.
 *
 * @public
 */
export interface Cache {
  /** Reads `key` directly — no stampede protection. See {@link CacheGetResult}. */
  get<T>(key: string): Promise<CacheGetResult<T>>;
  /** Writes `key` directly. */
  set<T>(key: string, value: T, options?: SetOptions): Promise<void>;
  /** Removes `key`. */
  invalidate(key: string): Promise<void>;
  /** Removes every key tagged `tag`. */
  invalidateTag(tag: string): Promise<void>;
  /**
   * Read-through cache access with single-flight cache-stampede
   * protection: for any key, however many concurrent `wrap` calls are
   * in flight, `fetcher` runs at most once, and every caller resolves
   * with (or rejects with) that one call's outcome.
   *
   * @remarks
   * Never throws {@link CacheBackendError}. A backend failure while
   * reading or writing the cache inside `wrap` is swallowed and treated
   * as a miss — `wrap`'s promise can only reject the way `fetcher`
   * itself rejects. See the README for why.
   *
   * @param key - Cache key.
   * @param fetcher - Called on a miss to produce the value. Its result is
   * stored back via {@link Cache.set} (best-effort — see above) before
   * being returned.
   * @param options - Forwarded to the internal `set` on a miss.
   */
  wrap<T>(key: string, fetcher: () => Promise<T>, options?: WrapOptions): Promise<T>;
}
