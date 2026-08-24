import { describe, expect, it } from 'vitest';
import { createMemoryBackend } from '../../src/backends/memory.js';

/**
 * Eviction under memory pressure is scoped to the in-memory LRU backend
 * only — the Redis backend has no eviction logic of its own; a real
 * Redis instance's own `maxmemory-policy` governs that, and TTLs are the
 * caller's tool for keeping growth bounded there. See
 * `createRedisBackend`'s docs for why byte-size accounting isn't
 * attempted in this package at all.
 */
describe('memory backend — eviction under capacity pressure', () => {
  it('evicts the least-recently-used key once capacity is exceeded', async () => {
    const backend = createMemoryBackend({ maxEntries: 2 });
    await backend.set('a', 1);
    await backend.set('b', 2);
    await backend.set('c', 3); // pushes capacity to 3; 'a' is oldest

    expect(await backend.get('a')).toEqual({ hit: false });
    expect(await backend.get('b')).toEqual({ hit: true, value: 2 });
    expect(await backend.get('c')).toEqual({ hit: true, value: 3 });
  });

  it('a get() marks a key as recently used, protecting it from the next eviction', async () => {
    const backend = createMemoryBackend({ maxEntries: 2 });
    await backend.set('a', 1);
    await backend.set('b', 2);
    await backend.get('a'); // 'a' is now more recently used than 'b'
    await backend.set('c', 3); // should evict 'b', not 'a'

    expect(await backend.get('a')).toEqual({ hit: true, value: 1 });
    expect(await backend.get('b')).toEqual({ hit: false });
    expect(await backend.get('c')).toEqual({ hit: true, value: 3 });
  });

  it('a set() on an existing key counts as recently used too', async () => {
    const backend = createMemoryBackend({ maxEntries: 2 });
    await backend.set('a', 1);
    await backend.set('b', 2);
    await backend.set('a', 'updated'); // re-set 'a': now more recent than 'b'
    await backend.set('c', 3); // should evict 'b'

    expect(await backend.get('a')).toEqual({ hit: true, value: 'updated' });
    expect(await backend.get('b')).toEqual({ hit: false });
  });

  it('evicting a tagged key cleans up its tag membership too', async () => {
    const backend = createMemoryBackend({ maxEntries: 1 });
    await backend.set('a', 1, { tags: ['x'] });
    await backend.set('b', 2); // evicts 'a'

    // If eviction leaked tag bookkeeping, this would still find 'a'
    // reachable via its tag despite the key itself being gone.
    await expect(backend.invalidateTag('x')).resolves.toBeUndefined();
    expect(await backend.get('b')).toEqual({ hit: true, value: 2 });
  });

  it('never holds more than maxEntries at once across many writes', async () => {
    const backend = createMemoryBackend({ maxEntries: 10 });
    for (let i = 0; i < 100; i += 1) {
      await backend.set(`key-${i}`, i);
    }
    let hits = 0;
    for (let i = 0; i < 100; i += 1) {
      const result = await backend.get(`key-${i}`);
      if (result.hit) hits += 1;
    }
    expect(hits).toBe(10);
    // The 10 survivors must be exactly the 10 most recently written.
    for (let i = 90; i < 100; i += 1) {
      expect(await backend.get(`key-${i}`)).toEqual({ hit: true, value: i });
    }
  });
});
