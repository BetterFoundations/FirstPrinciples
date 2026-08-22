import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { NotFoundError } from '@firstprinciples/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiClient } from '../../src/client.js';

/**
 * Everything else in this suite mocks `fetch`. This file exercises the
 * client against a real HTTP server on loopback — real headers, real JSON
 * framing, a real status line — so a mock that happened to agree with
 * itself can't hide a genuine protocol-handling bug.
 */

let server: Server;
let baseUrl: string;
let flakyAttempts = 0;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
}

beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && /^\/users\/[^/]+$/.test(url.pathname)) {
        const id = url.pathname.split('/').pop();
        sendJson(res, 200, { id, name: 'Ada Lovelace' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/users') {
        const body = JSON.parse(await readBody(req)) as { name: string };
        expect(req.headers['content-type']).toBe('application/json');
        sendJson(res, 201, { id: 'new-1', name: body.name });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/not-found') {
        sendJson(res, 404, { message: 'No such user', code: 'USER_NOT_FOUND' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/no-content') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'GET' && url.pathname === '/flaky') {
        flakyAttempts += 1;
        if (flakyAttempts < 3) {
          sendJson(res, 503, { message: 'temporarily unavailable' });
          return;
        }
        sendJson(res, 200, { attempts: flakyAttempts });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/echo-headers') {
        sendJson(res, 200, { authorization: req.headers['authorization'] ?? null });
        return;
      }

      res.writeHead(404);
      res.end();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('against a real HTTP server', () => {
  it('completes a real GET round-trip', async () => {
    const client = createApiClient({ baseUrl });
    const result = await client.get<{ id: string; name: string }>('/users/42');

    expect(result).toEqual({ ok: true, value: { id: '42', name: 'Ada Lovelace' }, status: 200 });
  });

  it('completes a real POST round-trip with a real content-type header', async () => {
    const client = createApiClient({ baseUrl });
    const result = await client.post<{ id: string; name: string }>('/users', { name: 'Grace' });

    expect(result).toEqual({
      ok: true,
      value: { id: 'new-1', name: 'Grace' },
      status: 201,
    });
  });

  it('surfaces a real 404 as a typed HTTP error, not a network failure', async () => {
    const client = createApiClient({ baseUrl });
    const result = await client.get('/not-found');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.kind).toBe('http');
    expect(result.status).toBe(404);
    expect(result.error).toBeInstanceOf(NotFoundError);
    expect(result.error.code).toBe('USER_NOT_FOUND');
  });

  it('treats a real 204 as success with an undefined value', async () => {
    const client = createApiClient({ baseUrl });
    const result = await client.get('/no-content');

    expect(result).toEqual({ ok: true, value: undefined, status: 204 });
  });

  it('recovers from real transient 503s via retry, against real timers', async () => {
    flakyAttempts = 0;
    const client = createApiClient({
      baseUrl,
      retry: { attempts: 3, backoffMs: 5 },
    });

    const result = await client.get<{ attempts: number }>('/flaky');

    expect(result).toEqual({ ok: true, value: { attempts: 3 }, status: 200 });
  });

  it('a genuinely unreachable host produces a real network-kind failure', async () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:1' });
    const result = await client.get('/x', { retry: false, timeoutMs: 2000 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.kind).toBe('network');
    expect(result.status).toBeUndefined();
  }, 10_000);

  it('onRequest injects a real Authorization header the server actually receives', async () => {
    const client = createApiClient({
      baseUrl,
      onRequest: (context) => {
        context.headers['authorization'] = 'Bearer real-token';
        return context;
      },
    });

    const result = await client.get<{ authorization: string }>('/echo-headers');

    expect(result).toEqual({
      ok: true,
      value: { authorization: 'Bearer real-token' },
      status: 200,
    });
  });

  it('the endpoint-definition pattern works end-to-end against a real server', async () => {
    const client = createApiClient({ baseUrl });
    const getUser = client.endpoint<{ id: string; name: string }>({
      method: 'GET',
      path: '/users/:id',
    });

    const result = await getUser({ id: '7' });

    expect(result).toEqual({ ok: true, value: { id: '7', name: 'Ada Lovelace' }, status: 200 });
  });
});
