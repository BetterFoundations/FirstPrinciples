import type { RedisClientLike, RedisPipelineLike } from '../../src/backends/redis.js';

/**
 * An in-memory stand-in for an `ioredis`-compatible client, used by the
 * unit and edge-case suites to exercise `createRedisBackend`'s own logic
 * (key layout, pipelining, tag bookkeeping) without a real Redis. The
 * `tests/integration/redis-testcontainers.test.ts` suite is what
 * verifies this backend against the real thing.
 */
export interface FakeRedisClient extends RedisClientLike {
  /** Test-only: makes every subsequent command reject, simulating a dropped connection. */
  setDown(down: boolean): void;
  /**
   * Test-only: makes the next `pipeline().exec()` resolve with one failed
   * sub-command instead of running the queued commands — simulating a
   * per-command failure (e.g. Redis `WRONGTYPE`) inside an otherwise-healthy
   * connection, distinct from the whole connection being down.
   */
  setNextPipelineCommandFails(fail: boolean): void;
  /**
   * Test-only: makes the next `pipeline().exec()` itself reject with a
   * plain `Error` (rather than resolving with a per-command error) —
   * simulating the connection dropping mid-pipeline, e.g. a reset
   * between queuing commands and the round trip that runs them.
   */
  setNextPipelineExecRejects(fail: boolean): void;
  /**
   * Test-only: makes the next `pipeline().exec()` resolve `null` —
   * `ioredis` returns `null` from a transactional `multi()` whose `WATCH`
   * was invalidated, and this backend's `assertPipelineOk` must treat
   * that as a failure rather than silently reading past it.
   */
  setNextPipelineExecReturnsNull(fail: boolean): void;
}

interface StoredValue {
  value: string;
  expiresAt: number | undefined;
}

export function createFakeRedisClient(): FakeRedisClient {
  const store = new Map<string, StoredValue>();
  const sets = new Map<string, Set<string>>();
  let down = false;
  let nextPipelineCommandFails = false;
  let nextPipelineExecRejects = false;
  let nextPipelineExecReturnsNull = false;

  function assertUp(): void {
    if (down) throw new Error('ECONNREFUSED: fake redis is down');
  }

  function isExpired(entry: StoredValue): boolean {
    return entry.expiresAt !== undefined && Date.now() >= entry.expiresAt;
  }

  function get(key: string): Promise<string | null> {
    assertUp();
    const entry = store.get(key);
    if (entry === undefined || isExpired(entry)) return Promise.resolve(null);
    return Promise.resolve(entry.value);
  }

  function set(key: string, value: string, mode?: 'PX', duration?: number): Promise<'OK'> {
    assertUp();
    store.set(key, {
      value,
      expiresAt: mode === 'PX' && duration !== undefined ? Date.now() + duration : undefined,
    });
    return Promise.resolve('OK');
  }

  function del(...keys: string[]): Promise<number> {
    assertUp();
    let count = 0;
    for (const key of keys) {
      if (store.delete(key)) count += 1;
      if (sets.delete(key)) count += 1;
    }
    return Promise.resolve(count);
  }

  function sadd(key: string, ...members: string[]): Promise<number> {
    assertUp();
    let members0 = sets.get(key);
    if (members0 === undefined) {
      members0 = new Set();
      sets.set(key, members0);
    }
    let added = 0;
    for (const member of members) {
      if (!members0.has(member)) {
        members0.add(member);
        added += 1;
      }
    }
    return Promise.resolve(added);
  }

  function srem(key: string, ...members: string[]): Promise<number> {
    assertUp();
    const members0 = sets.get(key);
    if (members0 === undefined) return Promise.resolve(0);
    let removed = 0;
    for (const member of members) {
      if (members0.delete(member)) removed += 1;
    }
    if (members0.size === 0) sets.delete(key);
    return Promise.resolve(removed);
  }

  function smembers(key: string): Promise<string[]> {
    assertUp();
    return Promise.resolve([...(sets.get(key) ?? [])]);
  }

  function pexpire(key: string, milliseconds: number): Promise<number> {
    assertUp();
    const entry = store.get(key);
    if (entry === undefined) return Promise.resolve(0);
    entry.expiresAt = Date.now() + milliseconds;
    return Promise.resolve(1);
  }

  function pipeline(): RedisPipelineLike {
    const ops: Array<() => Promise<unknown>> = [];
    const chain: RedisPipelineLike = {
      set(key: string, value: string, mode?: 'PX', duration?: number) {
        ops.push(() => set(key, value, mode, duration));
        return chain;
      },
      del(...keys: string[]) {
        ops.push(() => del(...keys));
        return chain;
      },
      sadd(key: string, ...members: string[]) {
        ops.push(() => sadd(key, ...members));
        return chain;
      },
      srem(key: string, ...members: string[]) {
        ops.push(() => srem(key, ...members));
        return chain;
      },
      pexpire(key: string, milliseconds: number) {
        ops.push(() => pexpire(key, milliseconds));
        return chain;
      },
      async exec() {
        if (nextPipelineExecRejects) {
          nextPipelineExecRejects = false;
          throw new Error('ECONNRESET: simulated pipeline exec rejection');
        }
        if (nextPipelineExecReturnsNull) {
          nextPipelineExecReturnsNull = false;
          return null;
        }
        if (nextPipelineCommandFails) {
          nextPipelineCommandFails = false;
          return [[new Error('WRONGTYPE simulated pipeline command failure'), null]];
        }
        const results: Array<[Error | null, unknown]> = [];
        for (const op of ops) {
          try {
            results.push([null, await op()]);
          } catch (error) {
            results.push([error instanceof Error ? error : new Error(String(error)), null]);
          }
        }
        return results;
      },
    };
    return chain;
  }

  return {
    get,
    set,
    del,
    sadd,
    smembers,
    pipeline,
    setDown(value: boolean) {
      down = value;
    },
    setNextPipelineCommandFails(value: boolean) {
      nextPipelineCommandFails = value;
    },
    setNextPipelineExecRejects(value: boolean) {
      nextPipelineExecRejects = value;
    },
    setNextPipelineExecReturnsNull(value: boolean) {
      nextPipelineExecReturnsNull = value;
    },
  };
}
