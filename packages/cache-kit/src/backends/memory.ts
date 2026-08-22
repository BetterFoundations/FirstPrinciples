import type { CacheBackend, CacheGetResult, SetOptions } from '../types.js';

/**
 * Options for {@link createMemoryBackend}.
 *
 * @public
 */
export interface MemoryBackendOptions {
  /**
   * Maximum number of entries held at once. Inserting past this evicts
   * the least-recently-used entry — "used" meaning read via `get` or
   * written via `set`, not merely present.
   *
   * @remarks
   * Scoped to entry **count**, not byte size. Approximating an arbitrary
   * JS value's memory footprint (closures, typed arrays, circular
   * structures) is unreliable enough that every well-known LRU
   * implementation in the ecosystem (e.g. `lru-cache`) defaults to the
   * same count-based accounting this does; a caller who needs a byte
   * budget is better served picking `maxEntries` from a known average
   * value size than trusting a `sizeof`-style estimate.
   *
   * @defaultValue 500
   */
  readonly maxEntries?: number;
}

interface MemoryEntry {
  readonly value: unknown;
  readonly expiresAt: number | undefined;
  readonly tags: readonly string[];
}

const DEFAULT_MAX_ENTRIES = 500;

/**
 * An in-memory LRU {@link CacheBackend}.
 *
 * @remarks
 * Expiry is checked lazily, on `get` — there is no background timer
 * sweeping expired entries. An expired-but-unread entry still occupies a
 * capacity slot until it is either read (and evicted right there) or
 * pushed out by the LRU policy; this trades a small amount of memory
 * pressure for not keeping the process alive with a timer and not
 * needing any coordination with a caller's fake-timer test setup.
 *
 * @public
 */
export function createMemoryBackend(options: MemoryBackendOptions = {}): CacheBackend {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  if (maxEntries < 1) {
    throw new RangeError('maxEntries must be at least 1');
  }

  // A `Map` preserves insertion order, which this backend repurposes as
  // recency order: `touch` deletes-then-reinserts a key to move it to the
  // most-recently-used end, so the least-recently-used key is always
  // whatever `store.keys().next()` yields.
  const store = new Map<string, MemoryEntry>();
  const tagIndex = new Map<string, Set<string>>();

  function isExpired(entry: MemoryEntry): boolean {
    return entry.expiresAt !== undefined && Date.now() >= entry.expiresAt;
  }

  function untag(key: string, tags: readonly string[]): void {
    for (const tag of tags) {
      const members = tagIndex.get(tag);
      // A duplicate tag in the same `tags` array (`{ tags: ['x', 'x'] }`)
      // is a real, if unusual, caller input: the first iteration can
      // already have emptied and removed `tagIndex`'s entry for `tag`,
      // so the second must tolerate it being gone rather than assume
      // one-to-one correspondence with `tags`' own length.
      if (members === undefined) continue;
      members.delete(key);
      if (members.size === 0) tagIndex.delete(tag);
    }
  }

  /** The single place a key is fully removed — value and every tag membership. */
  function removeKey(key: string): void {
    const entry = store.get(key);
    if (entry === undefined) return;
    store.delete(key);
    untag(key, entry.tags);
  }

  function touch(key: string, entry: MemoryEntry): void {
    store.delete(key);
    store.set(key, entry);
  }

  return {
    async get<T>(key: string): Promise<CacheGetResult<T>> {
      const entry = store.get(key);
      if (entry === undefined) return { hit: false };
      if (isExpired(entry)) {
        removeKey(key);
        return { hit: false };
      }
      touch(key, entry);
      return { hit: true, value: entry.value as T };
    },

    async set<T>(key: string, value: T, setOptions: SetOptions = {}): Promise<void> {
      // Clears any previous tag memberships before re-tagging, so a key
      // re-`set` with a different (or no) tag list can never be found by
      // an `invalidateTag` call for a tag it no longer carries.
      removeKey(key);

      const entry: MemoryEntry = {
        value,
        expiresAt: setOptions.ttlMs === undefined ? undefined : Date.now() + setOptions.ttlMs,
        tags: setOptions.tags ?? [],
      };
      store.set(key, entry);
      for (const tag of entry.tags) {
        let members = tagIndex.get(tag);
        if (members === undefined) {
          members = new Set();
          tagIndex.set(tag, members);
        }
        members.add(key);
      }

      if (store.size > maxEntries) {
        // `store.size > maxEntries >= 1` guarantees at least one entry
        // exists, so the iterator cannot be `done` here — this satisfies
        // `MapIterator#next()`'s `value: K | undefined` typing, not a
        // real "maybe empty" case.
        removeKey(store.keys().next().value as string);
      }
    },

    async delete(key: string): Promise<void> {
      removeKey(key);
    },

    async invalidateTag(tag: string): Promise<void> {
      const members = tagIndex.get(tag);
      if (members === undefined) return;
      // Copy first: `removeKey` mutates `members` itself (via `untag`),
      // so iterating the live set while removing from it would skip
      // entries.
      for (const key of [...members]) {
        removeKey(key);
      }
    },
  };
}
