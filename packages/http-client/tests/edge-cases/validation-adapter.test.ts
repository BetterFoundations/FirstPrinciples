import { ValidationError } from '@firstprinciples/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';
import type { ValidateFn } from '../../src/types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * `ValidateFn` is genuinely generic (`<T>(schema, data) => T`); a plain
 * `vi.fn` returning `unknown` can't satisfy an arbitrary `T`. `never` is
 * assignable to every `T`, so wrapping the mock this way keeps the mock
 * itself inspectable (`mock.mock.calls`, `toHaveBeenCalledWith`) while the
 * thing actually passed to `createApiClient` type-checks as `ValidateFn`.
 */
function passthroughValidate(): { validate: ValidateFn; mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn((_schema: unknown, data: unknown) => data);
  const validate: ValidateFn = (schema, data) => mock(schema, data) as never;
  return { validate, mock };
}

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Item 4 of this package's brief: the validation adapter is a pluggable
// slot, not a dependency — this package must never import Zod or Valibot
// itself — and a validation failure is a distinct ApiResult variant, not a
// thrown exception.
describe('validation adapter', () => {
  it('is invoked with the per-call schema and the parsed response body', async () => {
    stubFetch(jsonResponse({ id: 1, name: 'Ada' }));
    const { validate, mock } = passthroughValidate();
    const client = createApiClient({ baseUrl: 'https://api.example.com', validate });

    const result = await client.get('/x', { schema: 'UserSchema' });

    expect(mock).toHaveBeenCalledWith('UserSchema', { id: 1, name: 'Ada' });
    expect(result).toEqual({ ok: true, value: { id: 1, name: 'Ada' }, status: 200 });
  });

  it('a throwing adapter produces a validation-kind ApiErr, never a rejected promise', async () => {
    stubFetch(jsonResponse({ id: 'not-a-number' }));
    const validate = (): never => {
      throw new Error('id must be a number');
    };
    const client = createApiClient({ baseUrl: 'https://api.example.com', validate });

    const result = await client.get('/x', { schema: {} });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.kind).toBe('validation');
    expect(result.error).toBeInstanceOf(ValidationError);
    expect((result.error.cause as Error).message).toBe('id must be a number');
  });

  it('is skipped when a call passes no schema, even with an adapter configured', async () => {
    stubFetch(jsonResponse({ a: 1 }));
    const validate = vi.fn();
    const client = createApiClient({ baseUrl: 'https://api.example.com', validate });

    const result = await client.get('/x');

    expect(validate).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, value: { a: 1 }, status: 200 });
  });

  it('is skipped when the client has no adapter configured, even with a schema passed', async () => {
    stubFetch(jsonResponse({ a: 1 }));
    const client = createApiClient({ baseUrl: 'https://api.example.com' });

    const result = await client.get('/x', { schema: {} });

    expect(result).toEqual({ ok: true, value: { a: 1 }, status: 200 });
  });

  it('a validation failure is never retried by default', async () => {
    const fetchMock = stubFetch(jsonResponse({}));
    const validate = (): never => {
      throw new Error('always fails');
    };
    const client = createApiClient({ baseUrl: 'https://api.example.com', validate });

    const promise = client.get('/x', { schema: {} });
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('endpoint() bakes a schema in, applied on every call without repeating it', async () => {
    stubFetch(jsonResponse({ id: '1' }));
    const { validate, mock } = passthroughValidate();
    const client = createApiClient({ baseUrl: 'https://api.example.com', validate });
    const getUser = client.endpoint({ method: 'GET', path: '/users/:id', schema: 'UserSchema' });

    await getUser({ id: '1' });

    expect(mock).toHaveBeenCalledWith('UserSchema', { id: '1' });
  });

  it('a per-call schema overrides an endpoint-level schema', async () => {
    stubFetch(jsonResponse({ id: '1' }));
    const { validate, mock } = passthroughValidate();
    const client = createApiClient({ baseUrl: 'https://api.example.com', validate });
    const getUser = client.endpoint({ method: 'GET', path: '/users/:id', schema: 'DefaultSchema' });

    await getUser({ id: '1' }, { schema: 'OverrideSchema' });

    expect(mock).toHaveBeenCalledWith('OverrideSchema', { id: '1' });
  });
});
