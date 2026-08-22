import { NetworkError, NotFoundError } from '@firstprinciples/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Item 1 of this package's brief: a network failure (timeout/DNS, no
// response at all) must be a DISTINCT result variant from a typed HTTP
// error response — callers handle them differently (retry UI vs error
// message), and conflating them is the "looks like it works" bug.
describe('network failure vs. typed HTTP error response', () => {
  it('a DNS/connection failure is kind "network", with no status and a NetworkError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND')));
    const client = createApiClient({ baseUrl: 'https://api.example.com' });

    const result = await client.get('/x', { retry: false });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.kind).toBe('network');
    expect(result.status).toBeUndefined();
    expect(result.error).toBeInstanceOf(NetworkError);
  });

  it('a 404 response is kind "http", carrying the real status and a mapped error class', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ message: 'no such user' }, 404)),
    );
    const client = createApiClient({ baseUrl: 'https://api.example.com' });

    const result = await client.get('/x', { retry: false });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.kind).toBe('http');
    expect(result.status).toBe(404);
    expect(result.error).toBeInstanceOf(NotFoundError);
    expect(result.error).not.toBeInstanceOf(NetworkError);
  });

  it('a caller can branch on `kind` alone without inspecting the error instance', async () => {
    const outcomes: ('http' | 'network')[] = [];
    const client = createApiClient({ baseUrl: 'https://api.example.com' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    const first = await client.get('/x', { retry: false });
    if (!first.ok) outcomes.push(first.kind as 'http' | 'network');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const second = await client.get('/x', { retry: false });
    if (!second.ok) outcomes.push(second.kind as 'http' | 'network');

    expect(outcomes).toEqual(['network', 'http']);
  });
});
