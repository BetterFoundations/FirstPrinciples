import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';
import type { RequestContext, ResponseContext } from '../../src/types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(...responses: Response[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const response of responses) fn.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createApiClient — request methods', () => {
  it('get() issues a GET with no body', async () => {
    const fetchMock = stubFetch(jsonResponse({ id: 1 }));
    const client = createApiClient({ baseUrl: 'https://api.example.com' });

    const result = await client.get<{ id: number }>('/users/1');

    expect(result).toEqual({ ok: true, value: { id: 1 }, status: 200 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/users/1');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('post() JSON-serializes the body and sets content-type', async () => {
    const fetchMock = stubFetch(jsonResponse({ ok: true }, 201));
    const client = createApiClient({ baseUrl: 'https://api.example.com' });

    const result = await client.post<{ ok: boolean }>('/users', { name: 'Ada' });

    expect(result).toEqual({ ok: true, value: { ok: true }, status: 201 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"Ada"}');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('does not overwrite a caller-supplied content-type', async () => {
    const fetchMock = stubFetch(jsonResponse({}));
    const client = createApiClient({ baseUrl: 'https://api.example.com' });

    await client.post(
      '/upload',
      { a: 1 },
      { headers: { 'content-type': 'application/merge-patch+json' } },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['content-type']).toBe(
      'application/merge-patch+json',
    );
  });

  it.each(['put', 'patch'] as const)('%s() sends a JSON body', async (method) => {
    const fetchMock = stubFetch(jsonResponse({ updated: true }));
    const client = createApiClient({ baseUrl: 'https://api.example.com' });

    // `method` only ever comes from the literal `['put', 'patch']` list above.
    // eslint-disable-next-line security/detect-object-injection
    await client[method]('/users/1', { name: 'Ada' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe(method.toUpperCase());
    expect(init.body).toBe('{"name":"Ada"}');
  });

  it('delete() issues a DELETE with no body', async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: 'https://api.example.com' });

    const result = await client.delete('/users/1');

    expect(result).toEqual({ ok: true, value: undefined, status: 204 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });
});

describe('createApiClient — headers', () => {
  it('merges default headers with per-call headers, per-call winning', async () => {
    const fetchMock = stubFetch(jsonResponse({}));
    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      defaultHeaders: { 'x-app': 'firstprinciples', 'x-env': 'default' },
    });

    await client.get('/x', { headers: { 'x-env': 'override' } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-app']).toBe('firstprinciples');
    expect(headers['x-env']).toBe('override');
  });
});

describe('createApiClient — hooks', () => {
  it('onRequest can inject a header before the request is sent', async () => {
    const fetchMock = stubFetch(jsonResponse({}));
    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      onRequest: (context: RequestContext) => {
        context.headers['authorization'] = 'Bearer token';
        return context;
      },
    });

    await client.get('/x');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer token');
  });

  it('onRequest can be async', async () => {
    stubFetch(jsonResponse({}));
    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      onRequest: async (context: RequestContext) => {
        await Promise.resolve();
        context.headers['x-async'] = 'yes';
        return context;
      },
    });

    const result = await client.get<Record<string, never>>('/x');
    expect(result.ok).toBe(true);
  });

  it('onResponse runs before the body is parsed, and can replace the response', async () => {
    stubFetch(jsonResponse({ original: true }));
    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      onResponse: (context: ResponseContext) => ({
        ...context,
        response: jsonResponse({ replaced: true }),
      }),
    });

    const result = await client.get<{ replaced?: boolean; original?: boolean }>('/x');
    expect(result).toEqual({ ok: true, value: { replaced: true }, status: 200 });
  });

  it('onResponse receives the request context it responded to', async () => {
    stubFetch(jsonResponse({}));
    let seenUrl: string | undefined;
    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      onResponse: (context: ResponseContext) => {
        seenUrl = context.request.url;
        return context;
      },
    });

    await client.get('/widgets/9');
    expect(seenUrl).toBe('https://api.example.com/widgets/9');
  });
});

describe('createApiClient — endpoint()', () => {
  it('interpolates path params and returns a typed ApiResult', async () => {
    const fetchMock = stubFetch(jsonResponse({ id: '123', name: 'Ada' }));
    const client = createApiClient({ baseUrl: 'https://api.example.com' });
    const getUser = client.endpoint<{ id: string; name: string }>({
      method: 'GET',
      path: '/users/:id',
    });

    const result = await getUser({ id: '123' });

    expect(result).toEqual({ ok: true, value: { id: '123', name: 'Ada' }, status: 200 });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.example.com/users/123');
  });

  it('passes a body through to a write endpoint', async () => {
    const fetchMock = stubFetch(jsonResponse({ id: '1' }, 201));
    const client = createApiClient({ baseUrl: 'https://api.example.com' });
    const createUser = client.endpoint<{ id: string }>({ method: 'POST', path: '/users' });

    await createUser({}, { body: { name: 'Ada' } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"name":"Ada"}');
  });

  it('rejects (does not silently swallow) a call missing a required path param', async () => {
    stubFetch(jsonResponse({}));
    const client = createApiClient({ baseUrl: 'https://api.example.com' });
    const getUser = client.endpoint<{ id: string }>({ method: 'GET', path: '/users/:id' });

    await expect(getUser()).rejects.toThrow(/Missing path parameter "id"/);
  });
});
