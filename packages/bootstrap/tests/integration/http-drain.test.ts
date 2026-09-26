import { EventEmitter } from 'node:events';
import {
  createServer,
  request,
  Agent,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHealthHandler,
  createService,
  httpServerResource,
  type Service,
} from '../../src/index.js';
import { deferred, recordingLogger } from '../support.js';

interface Reply {
  readonly status: number;
  readonly body: string;
  readonly headers: IncomingMessage['headers'];
}

function get(port: number, path: string, agent?: Agent): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, agent: agent ?? false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const portOf = (server: Server): number => (server.address() as AddressInfo).port;

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

/**
 * A service with a fake "db" (registered first, so stopped last) and an
 * HTTP server whose /work route holds the request open until released and
 * uses the db while doing so.
 */
async function startApp(options: { shutdownTimeoutMs?: number } = {}) {
  const events: string[] = [];
  let dbOpen = false;
  const releases: (() => void)[] = [];
  const received = { count: 0 };

  let service!: Service;
  const health = createHealthHandler({
    checkLiveness: () => service.checkLiveness(),
    checkReadiness: () => service.checkReadiness(),
  });
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (health(req, res)) return;
    received.count++;
    const gate = deferred();
    releases.push(gate.resolve);
    void gate.promise.then(() => {
      // The whole point: the db must still be open when an in-flight
      // request finishes during a drain.
      res.end(dbOpen ? 'db-ok' : 'db-closed');
    });
  });

  service = createService({
    name: 'app',
    logger: recordingLogger(),
    signalSource: new EventEmitter(),
    exit: vi.fn(),
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? 10_000,
  });
  const http = httpServerResource(server, { port: 0, host: '127.0.0.1' });
  service
    .addResource({
      name: 'db',
      start: () => {
        dbOpen = true;
        events.push('db:open');
      },
      stop: () => {
        dbOpen = false;
        events.push('db:closed');
      },
    })
    .addCheck({ name: 'db', check: () => dbOpen })
    .addResource(http);

  await service.start();
  cleanups.push(async () => {
    await service.shutdown();
    server.closeAllConnections();
  });
  return {
    service,
    server,
    http,
    port: portOf(server),
    events,
    releases,
    received,
    releaseAll: () => releases.splice(0).forEach((r) => r()),
  };
}

describe('httpServerResource — draining under load', () => {
  it('binds on start and serves', async () => {
    const app = await startApp();
    const pending = get(app.port, '/work');
    await vi.waitFor(() => expect(app.received.count).toBe(1));
    app.releaseAll();
    expect(await pending).toMatchObject({ status: 200, body: 'db-ok' });
  });

  it('lets every in-flight request finish, with the db still open, before the db closes', async () => {
    const app = await startApp();
    const inFlight = Array.from({ length: 20 }, (_, i) => get(app.port, `/work?i=${i}`));
    await vi.waitFor(() => expect(app.http.inFlight).toBe(20));

    const stopping = app.service.shutdown('SIGTERM');
    await vi.waitFor(() => expect(app.service.state).toBe('stopping'));
    // Release them one by one while the drain is under way.
    for (const release of app.releases.splice(0)) {
      release();
      await new Promise((r) => setTimeout(r, 1));
    }
    const replies = await Promise.all(inFlight);
    expect(replies.map((r) => `${r.status}:${r.body}`)).toEqual(
      Array.from({ length: 20 }, () => '200:db-ok'),
    );

    const result = await stopping;
    expect(result).toMatchObject({ ok: true, timedOut: false });
    expect(app.events).toEqual(['db:open', 'db:closed']);
    expect(app.http.inFlight).toBe(0);
  });

  it('refuses new connections once draining has begun', async () => {
    const app = await startApp();
    const held = get(app.port, '/work');
    await vi.waitFor(() => expect(app.http.inFlight).toBe(1));
    const stopping = app.service.shutdown();
    await vi.waitFor(() => expect(app.server.listening).toBe(false));
    await expect(get(app.port, '/late')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    app.releaseAll();
    await held;
    await stopping;
  });

  it('closes an idle keep-alive connection immediately instead of waiting for its timeout', async () => {
    const app = await startApp();
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    cleanups.push(async () => agent.destroy());
    const first = get(app.port, '/work', agent);
    await vi.waitFor(() => expect(app.http.inFlight).toBe(1));
    app.releaseAll();
    await first;
    // The agent now holds one idle, open socket to the server.
    const startedAt = Date.now();
    await app.service.shutdown();
    // Default keepAliveTimeout is 5 s; a drain that waited for it would be that slow.
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('answers a request already in flight when the drain began with Connection: close', async () => {
    const app = await startApp();
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    cleanups.push(async () => agent.destroy());
    const before = get(app.port, '/work', agent);
    await vi.waitFor(() => expect(app.received.count).toBe(1));
    app.releaseAll();
    expect((await before).headers.connection).toBe('keep-alive');

    const inFlight = get(app.port, '/work', agent);
    await vi.waitFor(() => expect(app.received.count).toBe(2));
    const stopping = app.service.shutdown();
    await vi.waitFor(() => expect(app.service.state).toBe('stopping'));
    app.releaseAll();
    const reply = await inFlight;
    expect(reply).toMatchObject({ status: 200, body: 'db-ok' });
    expect(reply.headers.connection).toBe('close');
    await stopping;
  });

  it('leaves a response whose headers were already sent alone, and still drains it', async () => {
    let release!: () => void;
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('partial;');
      release = () => res.end('done');
    });
    const service = createService({ logger: recordingLogger(), signals: false });
    service.addResource(httpServerResource(server, { port: 0, host: '127.0.0.1' }));
    await service.start();
    const reply = get(portOf(server), '/stream');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const stopping = service.shutdown();
    release();
    expect((await reply).body).toBe('partial;done');
    expect((await stopping).ok).toBe(true);
  });

  it('force-closes connections still open when the deadline passes, and reports the server as pending-then-stopped', async () => {
    const app = await startApp({ shutdownTimeoutMs: 200 });
    const stuck = get(app.port, '/work').catch((error: unknown) => error);
    await vi.waitFor(() => expect(app.http.inFlight).toBe(1));
    const result = await app.service.shutdown();
    // The stop was aborted at the deadline: the socket was destroyed, so the
    // client sees a reset rather than hanging forever.
    const outcome = await stuck;
    expect(outcome).toBeInstanceOf(Error);
    expect(result.durationMs).toBeGreaterThanOrEqual(190);
    expect(result.durationMs).toBeLessThan(2000);
    app.releaseAll();
  });

  it('readiness fails while draining; liveness keeps passing', async () => {
    const app = await startApp();
    expect((await get(app.port, '/readyz')).status).toBe(200);
    // New connections are refused once draining, so ask the service
    // directly; the HTTP mapping is covered in health-handler.test.ts.
    const held = get(app.port, '/work');
    await vi.waitFor(() => expect(app.http.inFlight).toBe(1));
    const stopping = app.service.shutdown();
    await vi.waitFor(() => expect(app.service.state).toBe('stopping'));
    expect((await app.service.checkReadiness()).status).toBe('fail');
    expect((await app.service.checkLiveness()).status).toBe('pass');
    app.releaseAll();
    await held;
    await stopping;
  });
});

describe('httpServerResource — start and stop edges', () => {
  it('fails startup cleanly on EADDRINUSE and rolls back what had started', async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    cleanups.push(() => new Promise((r) => blocker.close(r)));

    const events: string[] = [];
    const service = createService({ logger: recordingLogger(), signals: false });
    service
      .addResource({
        name: 'db',
        start: () => void events.push('open'),
        stop: () => void events.push('close'),
      })
      .addResource(
        httpServerResource(createServer(), { port: portOf(blocker), host: '127.0.0.1' }),
      );
    await expect(service.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(events).toEqual(['open', 'close']);
    expect(service.state).toBe('failed');
  });

  it('stopping a server that never started resolves immediately', async () => {
    const resource = httpServerResource(createServer(), { port: 0 });
    await expect(resource.stop?.(new AbortController().signal)).resolves.toBeUndefined();
  });

  it('stopping with an already-aborted signal force-closes at once', async () => {
    const server = createServer(() => undefined); // never answers
    const resource = httpServerResource(server, { port: 0, host: '127.0.0.1' });
    await resource.start?.();
    const hung = get(portOf(server), '/').catch((error: unknown) => error);
    await vi.waitFor(() => expect(resource.inFlight).toBe(1));
    const controller = new AbortController();
    controller.abort();
    await resource.stop?.(controller.signal);
    expect(await hung).toBeInstanceOf(Error);
  });

  it('defaults its name and passes stopOrder through', () => {
    expect(httpServerResource(createServer(), { port: 0 }).name).toBe('http');
    const named = httpServerResource(createServer(), { port: 0, name: 'admin', stopOrder: -5 });
    expect([named.name, named.stopOrder]).toEqual(['admin', -5]);
    expect('stopOrder' in httpServerResource(createServer(), { port: 0 })).toBe(false);
  });
});
