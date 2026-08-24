# @firstprinciples/cache-kit

## 0.1.0

### Minor Changes

- 0ee24c4: Initial release. A typed, backend-agnostic caching layer: `createCache` returns a
  client whose `get`/`set`/`invalidate`/`invalidateTag`/`wrap` methods work
  identically over `createMemoryBackend` (an in-memory LRU) or `createRedisBackend`
  (bring your own `ioredis`-compatible client) — both implement one `CacheBackend`
  interface. `wrap` provides single-flight cache-stampede protection: however many
  concurrent callers miss on the same key, the fetcher runs exactly once. A cache
  backend failure inside `wrap` is swallowed and falls through to the fetcher rather
  than failing the caller's request — `wrap` can only reject the way its own fetcher
  rejects. Tag-based invalidation is bidirectionally consistent on both backends: a
  key re-`set` with a different tag list, or removed directly, is always cleaned out
  of every tag it belonged to, not just the one that happened to be invalidated.
  `CacheGetResult` is deliberately not layered on `@firstprinciples/core`'s `Result`
  — a cache miss is an expected outcome, not a failure — while genuine backend
  failures throw the new `CacheBackendError` (an `AppError` subclass). ~2.1KB
  gzipped, against a 3KB budget.
