# @firstprinciples/queue

[![npm](https://img.shields.io/npm/v/@firstprinciples/queue.svg)](https://www.npmjs.com/package/@firstprinciples/queue)
[![CI](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml/badge.svg)](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@firstprinciples/queue.svg)](../../LICENSE)

Typed job queue conventions over [BullMQ](https://bullmq.io) 6: declare each
job's payload and result once, and every `add` call and every handler is
checked against it — with no generics at the call site. Retries come from
presets per job type, jobs that fail for good land in a real dead-letter
queue you can list and redrive, and metrics hooks report durations,
failures, dead-letters and queue depth to any backend.

A runnable version of the recipes below lives in
[`examples/queue`](../../examples/queue) — `REDIS_URL=redis://localhost:6379 pnpm --filter examples-queue start`.

## Install

```sh
pnpm add @firstprinciples/queue bullmq ioredis
```

`bullmq` (6.x) is a peer dependency. BullMQ 6 no longer bundles a Redis
client, so install `ioredis` alongside it.

## Quick start

```ts
import { createQueue, createWorker, defineJob, retryPresets } from '@firstprinciples/queue';

// Shared by producer and worker — types only, no handler code.
export const jobs = {
  sendEmail: defineJob<{ to: string; template: 'welcome' | 'reset' }, { messageId: string }>(),
  syncCrm: defineJob<{ accountId: string }>({ retry: retryPresets.patient }),
};

const connection = { host: 'localhost', port: 6379, maxRetriesPerRequest: null };

// Producer
const queue = createQueue({ name: 'outbound', jobs, connection });
const job = await queue.add('sendEmail', { to: 'ada@example.com', template: 'welcome' });
const { messageId } = await job.result({ timeoutMs: 30_000 }); // typed

// Worker — a missing handler, or a wrong return type, is a compile error
createWorker({
  name: 'outbound',
  jobs,
  connection,
  handlers: {
    sendEmail: async ({ to, template }) => ({ messageId: await mailer.send(to, template) }),
    syncCrm: async ({ accountId }, { signal }) => crm.sync(accountId, { signal }),
  },
});
```

## Why this exists

BullMQ is excellent at moving jobs through Redis, and deliberately
unopinionated about everything around that: job names are strings, payloads
are `any`, there is no dead-letter queue (a job that fails for good just sits
in the `failed` set), and nothing stops a producer sending a payload the
worker was never written for. Every team ends up rebuilding the same layer —
usually without the parts that only matter during an incident. This is that
layer, with the dead-letter transition verified against a real Redis.

## API

| Export                                                   | What it does                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `defineJob<Data, Result>(options?)`                      | Declares a job type. Options: `retry`, `validate` (infers `Data` when given), `isPermanent`.                                                                                               |
| `retryPresets`                                           | `none`, `standard` (5 attempts, exponential from 1 s), `patient` (10, from 5 s), `fixed(attempts, delayMs)`.                                                                               |
| `createQueue({ name, jobs, connection, prefix? })`       | A typed producer: `add`, `depth`, `deadLetter`, `close`, `bull`.                                                                                                                           |
| `queue.add(name, data, { delayMs?, jobId?, priority? })` | Validates, enqueues with the job's retry policy; resolves to `{ id, name, result() }`.                                                                                                     |
| `queue.deadLetter`                                       | `list({ limit? })`, `count()`, `redrive(id)`, `remove(id)`.                                                                                                                                |
| `queue.depth()`                                          | `{ waiting, active, delayed, failed, deadLettered }`.                                                                                                                                      |
| `createWorker({ name, jobs, handlers, connection, … })`  | A typed consumer: `start`, `stop(signal?)`, `bull`. Options: `concurrency`, `metrics`, `logger`, `depthIntervalMs`, `lockDurationMs`, `stalledIntervalMs`, `maxStalledCount`, `autostart`. |
| `PermanentJobError`                                      | Throw from a handler to skip remaining attempts and dead-letter at once.                                                                                                                   |
| `InvalidJobError`                                        | `add` rejects with this for an unknown name or a payload `validate` rejects.                                                                                                               |
| `QueueMetrics`                                           | `onCompleted`, `onFailed` (with `willRetry`), `onDeadLettered` (with `reason`), `onDepth`.                                                                                                 |

## Recipes

### Dead letters: see why, fix, redrive

Every job that fails for good is parked in `<queue>.dead-letter` with the
reason — `exhausted`, `permanent`, `invalid-payload`, `unknown-job` or
`stalled` — its payload, attempt count and last error:

```ts
for (const entry of await queue.deadLetter.list()) {
  console.log(entry.name, entry.reason, entry.error, entry.attempts);
}
// After fixing the downstream outage:
const newId = await queue.deadLetter.redrive(entry.id); // fresh attempts, removed from the DLQ
```

### Fail fast when retrying cannot help

```ts
import { NotFoundError } from '@firstprinciples/core';
import { PermanentJobError, defineJob } from '@firstprinciples/queue';

const jobs = {
  // Any NotFoundError from this handler goes straight to the DLQ.
  archiveUser: defineJob<{ userId: string }>({ isPermanent: (e) => e instanceof NotFoundError }),
};

handlers: {
  archiveUser: async ({ userId }) => {
    if (await isLegalHold(userId)) throw new PermanentJobError('user is under legal hold');
    // …
  },
}
```

### Metrics to Prometheus, and graceful shutdown with bootstrap

```ts
const worker = createWorker({
  name: 'outbound',
  jobs,
  connection,
  handlers,
  autostart: false,
  depthIntervalMs: 15_000,
  metrics: {
    onCompleted: (e) => duration.observe({ job: e.name }, e.durationMs / 1000),
    onFailed: (e) => failures.inc({ job: e.name, final: String(!e.willRetry) }),
    onDeadLettered: (e) => deadLetters.inc({ job: e.name, reason: e.reason }),
    onDepth: (e) => {
      waiting.set(e.waiting);
      dlqSize.set(e.deadLettered);
    },
  },
});

// A worker is structurally a @firstprinciples/bootstrap resource: SIGTERM
// stops taking jobs, lets active ones finish, and — if the shutdown deadline
// passes — aborts their signals so they are retried rather than lost.
service.addResource(worker);
```

A metrics hook that throws is logged and ignored; it can never fail a job.

## Notes on the design

- **Dead-lettering happens in one place.** Every final failure — exhausted
  retries, a permanent error, a bad payload, an unknown job name, and a job
  that stalled too often (which BullMQ fails without ever calling your
  code) — reaches the worker's `failed` event, and the decision to
  dead-letter reuses BullMQ's own retry rule. The dead-letter job id is
  derived from the original id, so a repeated write cannot duplicate an entry.
- **A dead-letter write that fails is logged, not lost:** the job stays in
  BullMQ's `failed` set. There is a small window — the process dying
  between BullMQ failing the job and the dead-letter write — in which a job
  is failed but not parked.
- **Payloads are validated twice when `validate` is given:** on `add`, so a
  bad payload fails at the producer, and in the worker, so a payload from an
  older or foreign producer never reaches the handler. A rejected payload is
  never retried — it cannot start passing.
- **Unknown job names are dead-lettered, not retried** — typically a newer
  producer deployed before its worker.
- **Jitter only shortens a delay** (BullMQ's semantics): with `0.5`, a 4 s
  backoff becomes 2–4 s.
- **Handlers get an `AbortSignal`.** It fires when the worker is stopped past
  its deadline or loses the job's lock; pass it to anything cancellable.
- Job ids you choose via `jobId` also deduplicate: adding an existing id is a
  no-op. BullMQ forbids integer ids and `:`.

## License

[MIT](../../LICENSE)
