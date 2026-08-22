import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryBackend } from '../../src/backends/memory.js';
import { createRedisBackend } from '../../src/backends/redis.js';
import { createFakeRedisClient } from '../helpers/fake-redis-client.js';
import type { CacheBackend } from '../../src/types.js';

describe.each<[string, () => CacheBackend]>([
  ['memory backend', () => createMemoryBackend()],
  ['redis backend (fake client)', () => createRedisBackend({ client: createFakeRedisClient() })],
])('TTL expiry boundary (%s)', (_label, makeBackend) => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is still a hit one millisecond before the TTL elapses', async () => {
    const backend = makeBackend();
    await backend.set('a', 'v', { ttlMs: 1000 });
    vi.setSystemTime(999);
    expect(await backend.get('a')).toEqual({ hit: true, value: 'v' });
  });

  it('is a miss exactly at the TTL boundary', async () => {
    const backend = makeBackend();
    await backend.set('a', 'v', { ttlMs: 1000 });
    vi.setSystemTime(1000);
    expect(await backend.get('a')).toEqual({ hit: false });
  });

  it('stays a miss well past the TTL', async () => {
    const backend = makeBackend();
    await backend.set('a', 'v', { ttlMs: 1000 });
    vi.setSystemTime(50_000);
    expect(await backend.get('a')).toEqual({ hit: false });
  });

  it('a re-set with a fresh TTL resets the expiry clock', async () => {
    const backend = makeBackend();
    await backend.set('a', 'v1', { ttlMs: 1000 });
    vi.setSystemTime(900);
    await backend.set('a', 'v2', { ttlMs: 1000 });
    // The re-set entry's own window is 900 + 1000 = 1900, not the
    // original 0 + 1000 = 1000 — proves the clock restarted from the
    // re-set, not the original write.
    vi.setSystemTime(1800);
    expect(await backend.get('a')).toEqual({ hit: true, value: 'v2' });
    vi.setSystemTime(1900);
    expect(await backend.get('a')).toEqual({ hit: false });
  });

  it('no ttlMs means no expiry, ever', async () => {
    const backend = makeBackend();
    await backend.set('a', 'v');
    vi.setSystemTime(1_000_000_000);
    expect(await backend.get('a')).toEqual({ hit: true, value: 'v' });
  });
});
