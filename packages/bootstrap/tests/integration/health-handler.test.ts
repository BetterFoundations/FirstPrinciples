import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createHealthHandler,
  toHealthBody,
  type HealthReport,
  type HealthSource,
} from '../../src/index.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function send(port: number, method: string, path: string) {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>(
    (resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method, path, agent: false }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      });
      req.on('error', reject);
      req.end();
    },
  );
}

const report = (
  status: HealthReport['status'],
  extra: Partial<HealthReport> = {},
): HealthReport => ({
  status,
  state: 'running',
  checks: {
    db: { status: 'pass', critical: true, durationMs: 3 },
    cache: {
      status: 'fail',
      critical: false,
      durationMs: 7,
      error: 'connect ECONNREFUSED 10.0.0.12:6379 user=admin',
    },
  },
  ...extra,
});

async function serve(source: HealthSource, options?: Parameters<typeof createHealthHandler>[1]) {
  const handle = createHealthHandler(source, options);
  const server = createServer((req, res) => {
    if (!handle(req, res)) res.writeHead(404).end('app route');
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
}

describe('createHealthHandler over real HTTP', () => {
  it('maps pass and warn to 200, fail to 503, as JSON that is never cached', async () => {
    const port = await serve({
      checkLiveness: async () => report('pass'),
      checkReadiness: async () => report('warn'),
    });
    const live = await send(port, 'GET', '/healthz');
    const ready = await send(port, 'GET', '/readyz');
    expect(live.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(live.headers['content-type']).toBe('application/json');
    expect(live.headers['cache-control']).toBe('no-store');

    const failing = await serve({
      checkLiveness: async () => report('pass'),
      checkReadiness: async () => report('fail'),
    });
    expect((await send(failing, 'GET', '/readyz')).status).toBe(503);
  });

  it('hides check error messages by default — they can name hosts and users', async () => {
    const port = await serve({
      checkLiveness: async () => report('warn'),
      checkReadiness: async () => report('warn'),
    });
    const body = JSON.parse((await send(port, 'GET', '/readyz')).body) as Record<string, unknown>;
    expect(body).toEqual({
      status: 'warn',
      state: 'running',
      checks: {
        db: { status: 'pass', critical: true, durationMs: 3 },
        cache: { status: 'fail', critical: false, durationMs: 7 },
      },
    });
  });

  it('includes error messages with verbose: true', async () => {
    const port = await serve(
      { checkLiveness: async () => report('warn'), checkReadiness: async () => report('warn') },
      { verbose: true },
    );
    const body = JSON.parse((await send(port, 'GET', '/readyz')).body) as {
      checks: { cache: { error: string } };
    };
    expect(body.checks.cache.error).toContain('ECONNREFUSED');
  });

  it('includes the reason when the state decided the answer', async () => {
    const port = await serve({
      checkLiveness: async () => report('pass'),
      checkReadiness: async () => ({
        status: 'fail',
        state: 'stopping',
        reason: 'service is stopping',
        checks: {},
      }),
    });
    const reply = await send(port, 'GET', '/readyz');
    expect(reply.status).toBe(503);
    expect(JSON.parse(reply.body)).toEqual({
      status: 'fail',
      state: 'stopping',
      reason: 'service is stopping',
      checks: {},
    });
  });

  it('answers HEAD with the status and no body', async () => {
    const port = await serve({
      checkLiveness: async () => report('fail'),
      checkReadiness: async () => report('pass'),
    });
    const reply = await send(port, 'HEAD', '/healthz');
    expect(reply.status).toBe(503);
    expect(reply.body).toBe('');
  });

  it('ignores the query string when matching paths', async () => {
    const port = await serve({
      checkLiveness: async () => report('pass'),
      checkReadiness: async () => report('pass'),
    });
    expect((await send(port, 'GET', '/readyz?full=1')).status).toBe(200);
  });

  it('passes other paths and other methods through to the app', async () => {
    const port = await serve({
      checkLiveness: async () => report('pass'),
      checkReadiness: async () => report('pass'),
    });
    expect(await send(port, 'GET', '/users')).toMatchObject({ status: 404, body: 'app route' });
    expect(await send(port, 'POST', '/healthz')).toMatchObject({ status: 404, body: 'app route' });
    expect(await send(port, 'GET', '/healthz/extra')).toMatchObject({ status: 404 });
  });

  it('honors custom paths', async () => {
    const port = await serve(
      { checkLiveness: async () => report('pass'), checkReadiness: async () => report('fail') },
      { livenessPath: '/live', readinessPath: '/ready' },
    );
    expect((await send(port, 'GET', '/live')).status).toBe(200);
    expect((await send(port, 'GET', '/ready')).status).toBe(503);
    expect((await send(port, 'GET', '/healthz')).status).toBe(404);
  });

  it('answers 503 (never hangs or crashes) when evaluating health itself throws', async () => {
    const port = await serve({
      checkLiveness: () => Promise.reject(new Error('bug in a check runner')),
      checkReadiness: async () => report('pass'),
    });
    const reply = await send(port, 'GET', '/healthz');
    expect(reply.status).toBe(503);
    expect(JSON.parse(reply.body)).toEqual({ status: 'fail', reason: 'health evaluation failed' });
  });

  it('handles a request with no url', () => {
    const handle = createHealthHandler({
      checkLiveness: async () => report('pass'),
      checkReadiness: async () => report('pass'),
    });
    expect(handle({ method: 'GET' } as never, {} as never)).toBe(false);
  });
});

describe('toHealthBody', () => {
  it('strips errors unless verbose, and leaves passing checks untouched', () => {
    expect(toHealthBody(report('warn'))).toEqual({
      status: 'warn',
      state: 'running',
      checks: {
        db: { status: 'pass', critical: true, durationMs: 3 },
        cache: { status: 'fail', critical: false, durationMs: 7 },
      },
    });
    expect(
      (toHealthBody(report('warn'), true).checks as Record<string, { error?: string }>).cache
        ?.error,
    ).toContain('6379');
  });
});
