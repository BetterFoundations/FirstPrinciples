# @firstprinciples/bootstrap

[![npm](https://img.shields.io/npm/v/@firstprinciples/bootstrap.svg)](https://www.npmjs.com/package/@firstprinciples/bootstrap)
[![CI](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml/badge.svg)](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@firstprinciples/bootstrap.svg)](../../LICENSE)

The start and end of a Node service's life: environment validation that
fails fast — naming every bad variable at once — before anything binds a
port; ordered graceful shutdown on `SIGTERM`/`SIGINT` that drains in-flight
HTTP requests before the database they use is closed; and `/healthz` +
`/readyz` endpoints over pluggable checks.

A runnable version of the recipes below lives in
[`examples/bootstrap`](../../examples/bootstrap) — `pnpm --filter examples-bootstrap start`.

## Install

```sh
pnpm add @firstprinciples/bootstrap
```

## Quick start

```ts
import { createServer } from 'node:http';
import {
  createHealthHandler,
  createService,
  envVar,
  httpServerResource,
  requireEnv,
} from '@firstprinciples/bootstrap';

// 1. Validate first. On failure this logs every problem and exits(1).
const env = requireEnv({
  PORT: envVar.port().default(3000),
  DATABASE_URL: envVar.url({ protocols: ['postgres', 'postgresql'] }),
});

const service = createService({ name: 'api' });
const health = createHealthHandler(service);
const server = createServer((req, res) => {
  if (health(req, res)) return; // /healthz, /readyz
  res.end('hello');
});

// 2. Register in dependency order: the port binds last, drains first.
service
  .addResource({ name: 'db', start: () => db.connect(), stop: () => db.end() })
  .addCheck({ name: 'db', check: () => db.ping() })
  .addResource(httpServerResource(server, { port: env.PORT }));

// 3. Start. SIGTERM/SIGINT now shut it down gracefully and exit.
await service.start();
```

## Why this exists

Every service needs the same startup and shutdown code, and it is almost
always subtly wrong in the same places: env validation that stops at the
first missing variable (one redeploy per typo), a SIGTERM handler that
closes the database while requests are still using it, a second SIGTERM
that starts a second shutdown on top of the first, and a readiness probe
that keeps saying "ready" while the pod drains — so the load balancer keeps
sending traffic to a server that has stopped accepting it. This package
gets those right once, with the partial-failure paths tested against a
real `node:http` server rather than mocks.

## API

| Export                                                                                                  | What it does                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `requireEnv(spec, options?)`                                                                            | Validates `process.env` against `spec`; logs every issue and exits(1) on failure. Returns a typed, frozen env. |
| `loadEnv(spec, source?)`                                                                                | The same validation as a `Result<Env, EnvValidationError>`, never throwing or exiting.                         |
| `envVar.string()` `.number(opts?)` `.port()` `.boolean()` `.url(opts?)` `.enum([...])` `.custom(parse)` | Per-variable specs. Chain `.optional()` or `.default(value)`.                                                  |
| `createService(options?)`                                                                               | A `Service`: `addResource`, `addCheck`, `start`, `shutdown`, `checkLiveness`, `checkReadiness`, `state`.       |
| `httpServerResource(server, { port, host?, name?, stopOrder? })`                                        | Binds a `node:http` server on start; drains it on stop. Exposes `inFlight`.                                    |
| `createHealthHandler(service, { livenessPath?, readinessPath?, verbose? })`                             | A `(req, res) => boolean` handler for `/healthz` and `/readyz`.                                                |
| `toHealthBody(report, verbose?)`                                                                        | The JSON body the handler sends — for wiring probes into Express/Fastify/Hono routes.                          |
| `EnvValidationError`                                                                                    | A `core` `ValidationError` (code `ENV_VALIDATION_ERROR`, status 500) carrying every `issue`.                   |
| `LifecycleError`                                                                                        | Thrown for lifecycle misuse: registering after start, starting twice, duplicate names.                         |

`createService` options: `name`, `logger` (anything with `info`/`warn`/`error`;
defaults to `@firstprinciples/logger`), `shutdownTimeoutMs` (default 25 000),
`drainDelayMs` (default 0), `checkTimeoutMs` (default 3000), `signals`
(default `['SIGTERM', 'SIGINT']`, or `false`), `exit` (default `process.exit`).

## Recipes

### Kubernetes: stop routing before you stop serving

When a pod is deleted, the endpoint removal and the SIGTERM race each other.
A short drain delay keeps serving while `/readyz` fails, so the load balancer
has time to notice before connections are refused:

```ts
const service = createService({
  name: 'api',
  drainDelayMs: 5_000, // readiness fails immediately; serving continues for 5 s
  shutdownTimeoutMs: 25_000, // under the default 30 s terminationGracePeriodSeconds
});
```

The drain delay counts against `shutdownTimeoutMs`, never on top of it.

### Control shutdown order explicitly

By default the last resource started is the first stopped. When that is not
the dependency order, set `stopOrder` (lower stops first; ties stop in reverse
registration order):

```ts
service
  .addResource({ name: 'metrics', start: startMetrics, stop: flushMetrics, stopOrder: 10 }) // last out
  .addResource({ name: 'db', start: connectDb, stop: closeDb })
  .addResource({ name: 'worker', start: startWorker, stop: (signal) => worker.close({ signal }) })
  .addResource(httpServerResource(server, { port: env.PORT }));
// stops: http → worker → db → metrics
```

A `stop` receives an `AbortSignal` that fires at the deadline — the moment to
cut corners (force-close sockets, abandon a batch). A stop that ignores it is
abandoned and reported in `ShutdownResult.pending`.

### Health checks with Express, Fastify or Hono

```ts
app.get('/readyz', async (_req, res) => {
  const report = await service.checkReadiness();
  res
    .status(report.status === 'fail' ? 503 : 200)
    .set('Cache-Control', 'no-store')
    .json(toHealthBody(report));
});

service
  .addCheck({ name: 'db', check: () => db.ping(), timeoutMs: 1000 })
  .addCheck({ name: 'cache', check: () => redis.ping(), critical: false }) // failing only downgrades to 'warn'
  .addCheck({ name: 'event-loop', kind: 'liveness', check: () => lag() < 1000 });
```

Concurrent probes share one evaluation, so a slow check cannot pile up.

### Bring your own schema library for env vars

```ts
import { z } from 'zod';

const env = requireEnv({
  ALLOWED_ORIGINS: envVar.custom((raw) => z.string().url().array().parse(raw.split(','))),
});
```

## Notes on the design

- **Every issue at once.** Env validation is per variable, so a spec with
  three problems produces one error naming all three, in spec order.
- **Values never leak.** Built-in parsers never echo a rejected value — env
  values are as often secrets as not — and `requireEnv` logs variable names
  only. A `custom` parser's message is reported verbatim; keep values out of it.
- **Empty means unset.** `DATABASE_URL=` in a `.env` file is treated as
  missing, which is almost always what was meant.
- **Readiness and liveness differ on purpose.** `/readyz` fails in every
  state but `running`, including throughout the drain. `/healthz` reports
  only liveness checks and keeps answering honestly while draining, so an
  orchestrator does not kill a pod that is shutting down correctly.
- **Shutdown is idempotent.** Every `shutdown()` call and every repeated
  signal gets the same promise; a second SIGTERM is logged and ignored.
- **Only signal-triggered shutdowns exit.** Calling `service.shutdown()`
  yourself never calls `process.exit`.
- **Probe responses hide check errors by default** — a driver's error
  message can name internal hosts and users. Opt in with `verbose: true`.
- **Draining** marks in-flight responses whose headers have not been sent
  `Connection: close`, closes idle keep-alive sockets immediately (instead of
  waiting out `keepAliveTimeout`), and force-closes whatever remains at the
  deadline.

## License

[MIT](../../LICENSE)
