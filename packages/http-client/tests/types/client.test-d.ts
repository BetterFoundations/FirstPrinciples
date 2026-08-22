import { AppError, isErr, isOk, NotFoundError, type Result } from '@firstprinciples/core';
import { describe, expectTypeOf, it } from 'vitest';
import { createApiClient } from '../../src/client.js';
import type { ApiErr, ApiOk, ApiResult } from '../../src/types.js';

interface User {
  id: string;
  name: string;
}

const client = createApiClient({ baseUrl: 'https://api.example.com' });

describe('ApiResult narrowing', () => {
  it('narrows the ok branch to ApiOk, with status and value', async () => {
    const result = await client.get<User>('/users/1');

    if (result.ok) {
      expectTypeOf(result).toEqualTypeOf<ApiOk<User>>();
      expectTypeOf(result.value).toEqualTypeOf<User>();
      expectTypeOf(result.status).toEqualTypeOf<number>();
    } else {
      expectTypeOf(result).toEqualTypeOf<ApiErr<AppError>>();
      expectTypeOf(result.kind).toEqualTypeOf<'http' | 'network' | 'validation'>();
      expectTypeOf(result.status).toEqualTypeOf<number | undefined>();
    }
  });

  it("narrows through core's own isOk/isErr without losing status or kind", async () => {
    const result = await client.get<User>('/users/1');

    if (isOk(result)) {
      expectTypeOf(result).toEqualTypeOf<ApiOk<User>>();
    } else if (isErr(result)) {
      expectTypeOf(result).toEqualTypeOf<ApiErr<AppError>>();
      expectTypeOf(result.error.httpStatus).toEqualTypeOf<number>();
    }
  });

  it('stays assignable to a plain core Result, for a caller that ignores transport detail', () => {
    expectTypeOf<ApiResult<User>>().toExtend<Result<User, AppError>>();
  });

  it('keeps a narrowed error type usable through the client generics', async () => {
    const result = await client.get<User, NotFoundError>('/users/1');
    if (!result.ok) {
      expectTypeOf(result.error).toEqualTypeOf<NotFoundError>();
    }
  });
});

describe('request methods', () => {
  it('get takes no body argument — its second parameter is options, not a body', () => {
    // @ts-expect-error - get's third argument doesn't exist; its options
    // (second argument) has no `body` field for a caller to have meant.
    void client.get<User>('/x', {}, { extra: true });
  });

  it('post/put/patch accept an untyped body — the wire format is JSON, not a TS contract', async () => {
    await client.post<User>('/users', { name: 'Ada' });
    await client.post<User>('/users', 'raw string body is allowed too');
    await client.post<User>('/users');
  });
});

describe('endpoint()', () => {
  it('infers the success type from the explicit type argument', async () => {
    const getUser = client.endpoint<User>({ method: 'GET', path: '/users/:id' });
    const result = await getUser({ id: '1' });

    expectTypeOf(result).toEqualTypeOf<ApiResult<User, AppError>>();
  });

  it('accepts params and options, both optional', () => {
    const getUsers = client.endpoint<User[]>({ method: 'GET', path: '/users' });
    expectTypeOf(getUsers)
      .parameter(0)
      .toEqualTypeOf<Record<string, number | string> | undefined>();
  });
});
