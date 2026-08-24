# @firstprinciples/cache-kit

[![npm](https://img.shields.io/npm/v/@firstprinciples/cache-kit.svg)](https://www.npmjs.com/package/@firstprinciples/cache-kit)
[![CI](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml/badge.svg)](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@firstprinciples/cache-kit.svg)](../../LICENSE)

A typed, backend-agnostic caching layer: `get`/`set`/`wrap`/`invalidate`
over an in-memory LRU or Redis — interchangeable behind one interface —
with tag-based invalidation and single-flight cache-stampede protection.
~2.1KB gzipped.

A runnable version of every recipe below lives in
[`examples/cache-kit`](../../examples/cache-kit) —
`pnpm --filter examples-cache-kit start`.

## Install

```sh
pnpm add @firstprinciples/cache-kit
```

## Quick start

```ts
import { createCache, createMemoryBackend } from '@firstprinciples/cache-kit';

const cache = createCache(createMemoryBackend({ maxEntries: 1000 }));

// However many callers call this concurrently for the same id, fetchUser
// runs at most once — see "Cache-stampede protection" below.
const user = await cache.wrap(`user:${id}`, () => fetchUser(id), {
  ttlMs: 60_000,
  tags: ['users'],
});

// Invalidate every cached user at once, later:
await cache.invalidateTag('users');
```

Swap the backend for Redis without touching any call site — `wrap`,
`get`, `set`, `invalidate` and `invalidateTag` all mean the same thing on
both:

```ts
import { createCache, createRedisBackend } from '@firstprinciples/cache-kit';
import Redis from 'ioredis';

const cache = createCache(createRedisBackend({ client: new Redis() }));
```

## Why this exists

A cache needs three things most hand-rolled `Map`-based caches skip, and
that get subtly wrong when added later:

- **Cache-stampede protection.** Without it, a cold cache under load
  means N concurrent requests for the same key all miss and all hit
  your database/API at once — the "stampede." `wrap` guarantees exactly
  one upstream call per key, however many callers are waiting.
- **A cache backend failure must never become your application's
  failure.** If Redis is unreachable, `wrap` falls through to your
  fetcher instead of throwing — a cache is a performance optimization,
  not something your request path should depend on for correctness.
- **One interface, two backends.** Start with the in-memory LRU; move to
  Redis when you need caching shared across processes. No call site
  changes.

## API

| Export                               | Kind   | What it does                                                                                                                |
| ------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| `createCache(backend)`               | fn     | Builds a `Cache` over any `CacheBackend`.                                                                                   |
| `createMemoryBackend(options?)`      | fn     | An in-memory LRU `CacheBackend`. `{ maxEntries? }`, default 500.                                                            |
| `createRedisBackend(options)`        | fn     | A Redis-backed `CacheBackend`. `{ client, keyPrefix? }` — bring your own `ioredis`-compatible client.                       |
| `cache.get(key)`                     | method | `Promise<CacheGetResult<T>>` — `{ hit: true, value }` or `{ hit: false }`.                                                  |
| `cache.set(key, value, options?)`    | method | `{ ttlMs?, tags? }`.                                                                                                        |
| `cache.invalidate(key)`              | method | Removes one key.                                                                                                            |
| `cache.invalidateTag(tag)`           | method | Removes every key currently tagged `tag`.                                                                                   |
| `cache.wrap(key, fetcher, options?)` | method | Read-through with single-flight stampede protection. Never throws `CacheBackendError` — see below.                          |
| `CacheBackendError`                  | class  | Thrown by `get`/`set`/`invalidate`/`invalidateTag` on a real backend failure. Extends `@firstprinciples/core`'s `AppError`. |

## Recipes

### Cache-stampede protection

```ts
// However many of these run concurrently, `fetchExpensiveReport` is
// called exactly once, and every caller gets its result.
const results = await Promise.all(
  requests.map(() => cache.wrap('expensive-report', fetchExpensiveReport)),
);
```

### Tag-based invalidation

Tag related entries at write time, then drop them all in one call —
without tracking every individual key:

```ts
await cache.set(`user:${id}`, user, { tags: ['users', `org:${user.orgId}`] });

// Both of these remove `user:${id}` along with everything else sharing
// the tag:
await cache.invalidateTag('users');
await cache.invalidateTag(`org:${orgId}`);
```

Re-`set`ting a key with a different tag list fully replaces its old
tags — a key can never be reached by a tag it was re-tagged away from.

### A cache outage never fails a request

```ts
// If the Redis backend is unreachable, this still resolves with a
// freshly-fetched value — wrap's promise can only reject the way
// fetcher itself rejects, never because of the cache.
const user = await cache.wrap(`user:${id}`, () => fetchUser(id));
```

Direct reads/writes are not fail-soft the same way — `cache.get`,
`cache.set`, `cache.invalidate` and `cache.invalidateTag` all throw
`CacheBackendError` on a real backend failure, since a caller reaching
for them explicitly wants to know.

## Notes on the design

- **`CacheGetResult` is deliberately not layered on `core`'s `Result`.**
  A miss is not a failure — it is the cache's single most common,
  fully expected outcome on every cold read, unlike an HTTP 404 (a
  business fact) or a validation error (an input problem). Forcing it
  through `Result`'s `Ok`/`Err` binary would mean treating a miss as
  something to catch, when nothing went wrong. It is closer to
  `Map.get` returning `T | undefined`, spelled as a discriminated union
  so a cached `undefined` value is still distinguishable from a miss. A
  genuine backend failure — Redis unreachable — is a different,
  actually-exceptional outcome, and throws `CacheBackendError` instead.
- **Single-flight dedup lives above the backend, in `createCache`, not
  in either backend.** It applies identically no matter which backend
  is underneath: for any key, however many concurrent `wrap` calls are
  in flight, the fetcher runs once. The mechanism is a plain `Map` from
  key to in-flight promise, registered in the same synchronous
  stretch — no `await` in between — as the check that it was empty;
  that's what rules out two concurrent callers both starting a fetch.
- **Eviction under capacity pressure only applies to the in-memory LRU
  backend.** The Redis backend has no eviction logic of its own — a
  real Redis instance's own `maxmemory-policy` governs that, and TTLs
  are the caller's tool for keeping growth bounded. Approximating an
  arbitrary JS value's byte size reliably enough to drive eviction isn't
  attempted; `maxEntries` (count-based) is the same choice every
  well-known LRU library in the ecosystem makes.
- **Tag bookkeeping is bidirectional on both backends.** Each tagged key
  tracks its own current tags, not just the reverse (`tag → keys`)
  index — so re-`set`ting a key with a different tag list, or deleting
  it directly, always cleans up every tag it belonged to, not just the
  one that happened to be invalidated. One accepted gap: a Redis key
  that expires via its own TTL (rather than through `invalidate`/
  `invalidateTag`) isn't proactively pruned from its tag's set — Redis
  has no hook back into this package when that happens. The practical
  effect is bounded: a later `invalidateTag` may `DEL` an already-gone
  key (a no-op).
- **TTL expiry is a half-open interval.** A 1000ms TTL is a hit at
  +999ms and a miss at +1000ms (`Date.now() >= writeTime + ttlMs`).
  Checked lazily, on read — no background sweep, and no interference
  with a caller's fake-timer test setup.
- **The Redis backend never imports a Redis client library.** It types
  against a minimal, structurally-compatible `RedisClientLike`
  interface instead — pass a real `ioredis` instance straight in. An
  in-memory-only consumer never pays for the dependency, and this
  package's own bundle carries no Redis client code at all.

## License

MIT
