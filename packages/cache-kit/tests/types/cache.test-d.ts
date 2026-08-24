import { describe, expectTypeOf, it } from 'vitest';
import { AppError } from '@firstprinciples/core';
import { createCache } from '../../src/client.js';
import { createMemoryBackend } from '../../src/backends/memory.js';
import { CacheBackendError } from '../../src/errors.js';
import type { Cache, CacheGetResult } from '../../src/types.js';

interface User {
  id: string;
  name: string;
}

describe('CacheGetResult narrowing', () => {
  it('narrows the hit branch to carry `value`, and is not layered on Result', async () => {
    const cache = createCache(createMemoryBackend());
    const result = await cache.get<User>('user:1');

    expectTypeOf(result).toEqualTypeOf<CacheGetResult<User>>();
    if (result.hit) {
      expectTypeOf(result.value).toEqualTypeOf<User>();
    } else {
      // The miss branch carries no `value` at all — not `undefined`,
      // absent — and no `error` field either. A miss is not an Err.
      expectTypeOf(result).toEqualTypeOf<{ readonly hit: false }>();

      // @ts-expect-error - CacheGetResult has no `ok` discriminant; it is
      // deliberately not shaped like core's Result.
      void result.ok;
    }
  });
});

describe('wrap() infers T from the fetcher, not from a type argument', () => {
  it('a fetcher returning User makes wrap resolve to User', async () => {
    const cache = createCache(createMemoryBackend());
    const result = await cache.wrap('user:1', () =>
      Promise.resolve<User>({ id: '1', name: 'Ada' }),
    );
    expectTypeOf(result).toEqualTypeOf<User>();
  });
});

describe('CacheBackendError', () => {
  it('is an AppError subclass, narrowed to a literal name', () => {
    expectTypeOf<CacheBackendError>().toExtend<AppError>();
    expectTypeOf<CacheBackendError['name']>().toEqualTypeOf<'CacheBackendError'>();
  });
});

describe('Cache is backend-agnostic at the type level', () => {
  it('createCache returns the same Cache shape regardless of backend', () => {
    expectTypeOf(createCache(createMemoryBackend())).toEqualTypeOf<Cache>();
  });
});
