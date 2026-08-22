import { describe, expect, it } from 'vitest';
import { createRedisBackend } from '../../src/backends/redis.js';
import { createFakeRedisClient } from '../helpers/fake-redis-client.js';

describe('createRedisBackend', () => {
  it('is a miss for a key that was never set', async () => {
    const backend = createRedisBackend({ client: createFakeRedisClient() });
    expect(await backend.get('missing')).toEqual({ hit: false });
  });

  it('round-trips a JSON-serializable value', async () => {
    const backend = createRedisBackend({ client: createFakeRedisClient() });
    await backend.set('a', { n: 1, list: [1, 2, 3] });
    expect(await backend.get('a')).toEqual({ hit: true, value: { n: 1, list: [1, 2, 3] } });
  });

  it('delete removes a key; deleting an absent key is a no-op', async () => {
    const backend = createRedisBackend({ client: createFakeRedisClient() });
    await backend.set('a', 1);
    await backend.delete('a');
    expect(await backend.get('a')).toEqual({ hit: false });
    await expect(backend.delete('never-existed')).resolves.toBeUndefined();
  });

  it('namespaces keys under keyPrefix so two backends never collide on one client', async () => {
    const client = createFakeRedisClient();
    const backendA = createRedisBackend({ client, keyPrefix: 'app-a:' });
    const backendB = createRedisBackend({ client, keyPrefix: 'app-b:' });
    await backendA.set('shared-key', 'from-a');
    await backendB.set('shared-key', 'from-b');
    expect(await backendA.get('shared-key')).toEqual({ hit: true, value: 'from-a' });
    expect(await backendB.get('shared-key')).toEqual({ hit: true, value: 'from-b' });
  });

  it('surfaces a malformed stored value as CacheBackendError, not a silent miss', async () => {
    const client = createFakeRedisClient();
    // Reach past the backend to write a non-JSON payload directly, the
    // way corruption (a hand-edited key, a version-mismatch writer)
    // would actually happen.
    await client.set('v:a', 'not valid json{{{');
    const backend = createRedisBackend({ client });
    await expect(backend.get('a')).rejects.toMatchObject({ code: 'CACHE_CORRUPT_VALUE' });
  });

  describe('tag bookkeeping', () => {
    it('invalidateTag removes every key tagged with it', async () => {
      const client = createFakeRedisClient();
      const backend = createRedisBackend({ client });
      await backend.set('a', 1, { tags: ['users'] });
      await backend.set('b', 2, { tags: ['users'] });
      await backend.set('c', 3, { tags: ['posts'] });

      await backend.invalidateTag('users');

      expect(await backend.get('a')).toEqual({ hit: false });
      expect(await backend.get('b')).toEqual({ hit: false });
      expect(await backend.get('c')).toEqual({ hit: true, value: 3 });
    });

    it('invalidating an untagged / unknown tag is a no-op', async () => {
      const backend = createRedisBackend({ client: createFakeRedisClient() });
      await backend.set('a', 1);
      await expect(backend.invalidateTag('nothing-has-this-tag')).resolves.toBeUndefined();
      expect(await backend.get('a')).toEqual({ hit: true, value: 1 });
    });

    it('re-setting a key with a different tag list fully replaces its old tags', async () => {
      const client = createFakeRedisClient();
      const backend = createRedisBackend({ client });
      await backend.set('a', 1, { tags: ['old-tag'] });
      await backend.set('a', 2, { tags: ['new-tag'] });

      // The regression this guards: invalidating the tag `a` no longer
      // carries must not touch it.
      await backend.invalidateTag('old-tag');
      expect(await backend.get('a')).toEqual({ hit: true, value: 2 });

      await backend.invalidateTag('new-tag');
      expect(await backend.get('a')).toEqual({ hit: false });
    });

    it('is bidirectionally clean: deleting a multi-tagged key leaves no stray membership in its other tags', async () => {
      const client = createFakeRedisClient();
      const backend = createRedisBackend({ client });
      await backend.set('a', 1, { tags: ['tag-x', 'tag-y'] });

      await backend.delete('a');

      // Inspect the underlying tag sets directly (white-box): neither
      // should still list `a` after a direct delete, not just the tag
      // that was actually invalidated.
      expect(await client.smembers('t:tag-x')).toEqual([]);
      expect(await client.smembers('t:tag-y')).toEqual([]);
    });

    it('is bidirectionally clean: invalidating one tag on a multi-tagged key removes it from the other tag too', async () => {
      const client = createFakeRedisClient();
      const backend = createRedisBackend({ client });
      await backend.set('a', 1, { tags: ['tag-x', 'tag-y'] });

      await backend.invalidateTag('tag-x');

      expect(await backend.get('a')).toEqual({ hit: false });
      // `a` must be gone from tag-y's set too, or a later `invalidateTag`
      // on tag-y would try to delete an already-gone key (harmless) while
      // masking the real bug this guards: tag-y's set growing stale
      // forever for every multi-tagged key ever removed via a different
      // tag.
      expect(await client.smembers('t:tag-y')).toEqual([]);
    });
  });

  describe('backend failure propagation', () => {
    it('get throws CacheBackendError when the client is down', async () => {
      const client = createFakeRedisClient();
      const backend = createRedisBackend({ client });
      client.setDown(true);
      await expect(backend.get('a')).rejects.toBeInstanceOf(Error);
      await expect(backend.get('a')).rejects.toMatchObject({ code: 'CACHE_BACKEND_ERROR' });
    });

    it('set throws CacheBackendError when the client is down', async () => {
      const client = createFakeRedisClient();
      const backend = createRedisBackend({ client });
      client.setDown(true);
      await expect(backend.set('a', 1)).rejects.toMatchObject({ code: 'CACHE_BACKEND_ERROR' });
    });

    it('invalidateTag throws CacheBackendError when the client is down', async () => {
      const client = createFakeRedisClient();
      const backend = createRedisBackend({ client });
      client.setDown(true);
      await expect(backend.invalidateTag('t')).rejects.toMatchObject({
        code: 'CACHE_BACKEND_ERROR',
      });
    });

    it('a failed sub-command inside an otherwise-healthy pipeline is wrapped, not double-wrapped', async () => {
      // Distinct from "the connection is down": the pre-pipeline reads
      // (currentTagsOf) succeed here, and only the pipelined write
      // itself fails — the path that actually reaches assertPipelineOk's
      // own CacheBackendError and must be re-thrown as-is by the
      // surrounding catch, not wrapped a second time.
      const client = createFakeRedisClient();
      const backend = createRedisBackend({ client });
      await backend.set('a', 1, { tags: ['x'] });

      client.setNextPipelineCommandFails(true);
      await expect(backend.set('a', 2, { tags: ['y'] })).rejects.toMatchObject({
        code: 'CACHE_BACKEND_ERROR',
      });

      client.setNextPipelineCommandFails(true);
      await expect(backend.delete('a')).rejects.toMatchObject({ code: 'CACHE_BACKEND_ERROR' });

      await backend.set('b', 1, { tags: ['y'] });
      client.setNextPipelineCommandFails(true);
      await expect(backend.invalidateTag('y')).rejects.toMatchObject({
        code: 'CACHE_BACKEND_ERROR',
      });
    });

    it('a pipeline dropping mid-exec (a raw, unwrapped error) is itself wrapped into CacheBackendError', async () => {
      const client = createFakeRedisClient();
      const backend = createRedisBackend({ client });
      await backend.set('a', 1, { tags: ['x'] });

      client.setNextPipelineExecRejects(true);
      await expect(backend.set('a', 2, { tags: ['y'] })).rejects.toMatchObject({
        code: 'CACHE_BACKEND_ERROR',
      });

      client.setNextPipelineExecRejects(true);
      await expect(backend.delete('a')).rejects.toMatchObject({ code: 'CACHE_BACKEND_ERROR' });

      await backend.set('b', 1, { tags: ['y'] });
      client.setNextPipelineExecRejects(true);
      await expect(backend.invalidateTag('y')).rejects.toMatchObject({
        code: 'CACHE_BACKEND_ERROR',
      });
    });

    it('a pipeline exec resolving null (a discarded ioredis transaction) is treated as a failure', async () => {
      const client = createFakeRedisClient();
      const backend = createRedisBackend({ client });
      client.setNextPipelineExecReturnsNull(true);
      await expect(backend.set('a', 1)).rejects.toMatchObject({ code: 'CACHE_BACKEND_ERROR' });
    });
  });
});
