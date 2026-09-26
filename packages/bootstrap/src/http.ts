import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { HealthReport, Resource } from './types.js';

/**
 * Options for {@link httpServerResource}.
 *
 * @public
 */
export interface HttpServerResourceOptions {
  /** Port to bind. `0` asks the OS for a free one. */
  readonly port: number;
  readonly host?: string;
  /** Default `'http'`. */
  readonly name?: string;
  /** See {@link Resource.stopOrder}. */
  readonly stopOrder?: number;
}

/**
 * A {@link Resource} wrapping a `node:http` (or `node:https`) server.
 *
 * @public
 */
export interface HttpServerResource extends Resource {
  /** Requests received whose response has not yet finished. */
  readonly inFlight: number;
}

/**
 * Wraps a `node:http` server so a {@link Service} binds it on start and
 * drains it on stop.
 *
 * @remarks
 * `start` resolves once the port is bound, and rejects on a bind error
 * (`EADDRINUSE`), which fails the service's startup cleanly.
 *
 * `stop` drains, in this order: the server stops accepting connections;
 * idle keep-alive connections are closed at once; requests already in
 * flight run to completion, each answered with `Connection: close` where
 * the headers have not gone out yet, and their sockets are closed as soon
 * as they go idle; it resolves when the last connection closes. If the
 * service's shutdown deadline passes first, every remaining connection is
 * destroyed.
 *
 * Express, Fastify (`fastify.server`) and Hono's Node adapter all expose a
 * `node:http` server, so this covers them too.
 *
 * @public
 */
export function httpServerResource(
  server: Server,
  options: HttpServerResourceOptions,
): HttpServerResource {
  const open = new Set<ServerResponse>();
  let stopping = false;

  const markClosing = (res: ServerResponse): void => {
    // Once headers are out, the connection's fate is sealed; it is closed
    // as soon as it goes idle instead.
    if (!res.headersSent) res.setHeader('Connection', 'close');
  };

  // Prepended so it runs before the application's own request handler has
  // had a chance to send headers.
  server.prependListener('request', (_req: IncomingMessage, res: ServerResponse) => {
    open.add(res);
    if (stopping) markClosing(res);
    res.once('close', () => {
      open.delete(res);
      if (stopping) setImmediate(() => server.closeIdleConnections());
    });
  });

  return {
    name: options.name ?? 'http',
    ...(options.stopOrder === undefined ? {} : { stopOrder: options.stopOrder }),
    get inFlight() {
      return open.size;
    },

    start() {
      return new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(options.port, options.host);
      });
    },

    stop(signal) {
      stopping = true;
      // Requests already in flight: tell their clients this connection will
      // not be reused, so a keep-alive agent does not race a closing socket.
      for (const res of open) markClosing(res);
      return new Promise<void>((resolve) => {
        const forceClose = (): void => server.closeAllConnections();
        // The callback fires once every connection has closed. An error
        // here only means the server was never listening — nothing to drain.
        server.close(() => {
          signal.removeEventListener('abort', forceClose);
          resolve();
        });
        server.closeIdleConnections();
        if (signal.aborted) forceClose();
        else signal.addEventListener('abort', forceClose, { once: true });
      });
    },
  };
}

/**
 * The part of a {@link Service} the health handler needs.
 *
 * @public
 */
export interface HealthSource {
  checkLiveness(): Promise<HealthReport>;
  checkReadiness(): Promise<HealthReport>;
}

/**
 * Options for {@link createHealthHandler}.
 *
 * @public
 */
export interface HealthHandlerOptions {
  /** Default `'/healthz'`. */
  readonly livenessPath?: string;
  /** Default `'/readyz'`. */
  readonly readinessPath?: string;
  /**
   * Include each failing check's error message in the response body.
   * Default `false`: a health endpoint is usually reachable by more than
   * the orchestrator, and a driver's error message can name hosts, users
   * and ports. Pass/fail and timings are always included.
   */
  readonly verbose?: boolean;
}

/**
 * Converts a report to the body a probe returns.
 *
 * @public
 */
export function toHealthBody(report: HealthReport, verbose = false): Record<string, unknown> {
  const checks = Object.fromEntries(
    Object.entries(report.checks).map(([name, result]) => [
      name,
      verbose || result.error === undefined
        ? result
        : { status: result.status, critical: result.critical, durationMs: result.durationMs },
    ]),
  );
  return {
    status: report.status,
    state: report.state,
    ...(report.reason === undefined ? {} : { reason: report.reason }),
    checks,
  };
}

/**
 * A `node:http` request handler answering `/healthz` and `/readyz`.
 * Returns `true` if it handled the request, `false` to let your own
 * routing take it.
 *
 * @remarks
 * `pass` and `warn` answer 200, `fail` answers 503. `GET` and `HEAD` only.
 * Responses are `Cache-Control: no-store` — a cached probe is a lie.
 * For Express/Fastify/Hono routes, call {@link Service.checkReadiness}
 * and {@link toHealthBody} directly instead.
 *
 * @public
 */
export function createHealthHandler(
  service: HealthSource,
  options: HealthHandlerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => boolean {
  const livenessPath = options.livenessPath ?? '/healthz';
  const readinessPath = options.readinessPath ?? '/readyz';
  const verbose = options.verbose ?? false;

  return (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const probe =
      path === livenessPath ? 'liveness' : path === readinessPath ? 'readiness' : undefined;
    if (probe === undefined || (req.method !== 'GET' && req.method !== 'HEAD')) return false;

    const run = probe === 'liveness' ? service.checkLiveness() : service.checkReadiness();
    run
      .then((report) => ({
        code: report.status === 'fail' ? 503 : 200,
        body: toHealthBody(report, verbose),
      }))
      .catch(() => ({ code: 503, body: { status: 'fail', reason: 'health evaluation failed' } }))
      .then(({ code, body }) => {
        res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
      });
    return true;
  };
}
