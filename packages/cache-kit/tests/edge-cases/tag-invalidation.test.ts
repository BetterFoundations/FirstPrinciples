import { describe, expect, it } from 'vitest';
import { createCache } from '../../src/client.js';
import { createMemoryBackend } from '../../src/backends/memory.js';
import { createRedisBackend } from '../../src/backends/redis.js';
import { createFakeRedisClient } from '../helpers/fake-redis-client.js';
import type { CacheBackend } from '../../src/types.js';

/**
 * "Tag invalidation correctness" — the spec's own words — run through
 * `createCache` (not the backend directly) against both backends, so
 * this exercises the exact path a real consumer uses.
 */
describe.each<[string, () => CacheBackend]>([
  ['memory backend', () => createMemoryBackend()],
  ['redis backend (fake client)', () => createRedisBackend({ client: createFakeRedisClient() })],
])('tag invalidation correctness (%s)', (_label, makeBackend) => {
  it('invalidating one tag leaves untagged and differently-tagged keys untouched', async () => {
    const cache = createCache(makeBackend());
    await cache.set('user:1', 'Ada', { tags: ['users'] });
    await cache.set('user:2', 'Grace', { tags: ['users'] });
    await cache.set('post:1', 'Hello world', { tags: ['posts'] });
    await cache.set('config', 'static', {});

    await cache.invalidateTag('users');

    expect(await cache.get('user:1')).toEqual({ hit: false });
    expect(await cache.get('user:2')).toEqual({ hit: false });
    expect(await cache.get('post:1')).toEqual({ hit: true, value: 'Hello world' });
    expect(await cache.get('config')).toEqual({ hit: true, value: 'static' });
  });

  it('a key tagged with two tags is removed when EITHER tag is invalidated', async () => {
    const cache = createCache(makeBackend());
    await cache.set('shared', 'v', { tags: ['tag-a', 'tag-b'] });

    await cache.invalidateTag('tag-a');

    expect(await cache.get('shared')).toEqual({ hit: false });
  });

  it('invalidating the same tag twice in a row is safe and a no-op the second time', async () => {
    const cache = createCache(makeBackend());
    await cache.set('a', 1, { tags: ['x'] });
    await cache.invalidateTag('x');
    await expect(cache.invalidateTag('x')).resolves.toBeUndefined();
  });

  it('re-tagging a key away from a tag protects it from that tag later being invalidated', async () => {
    const cache = createCache(makeBackend());
    await cache.set('a', 'v1', { tags: ['old'] });
    await cache.set('a', 'v2', { tags: ['new'] });

    await cache.invalidateTag('old');

    expect(await cache.get('a')).toEqual({ hit: true, value: 'v2' });
  });

  it('wrap()-populated entries are reachable by their tag, same as a direct set()', async () => {
    const cache = createCache(makeBackend());
    await cache.wrap('user:1', () => Promise.resolve('Ada'), { tags: ['users'] });

    await cache.invalidateTag('users');

    expect(await cache.get('user:1')).toEqual({ hit: false });
  });
});
