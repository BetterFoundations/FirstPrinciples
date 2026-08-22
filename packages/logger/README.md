# @firstprinciples/logger

[![npm](https://img.shields.io/npm/v/@firstprinciples/logger.svg)](https://www.npmjs.com/package/@firstprinciples/logger)
[![CI](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml/badge.svg)](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@firstprinciples/logger.svg)](../../LICENSE)

Structured, isomorphic logging with automatic secret/PII redaction and
`AsyncLocalStorage` correlation IDs. Wraps [pino](https://getpino.io) on
Node; the browser build never imports pino or a Node built-in — confirmed by
scanning the actual built bundle, not just the source.

A runnable version of every recipe below lives in
[`examples/logger`](../../examples/logger) — `pnpm --filter examples-logger start`.

## Install

```sh
pnpm add @firstprinciples/logger
```

## Quick start

```ts
import { createLogger, runWithCorrelationId } from '@firstprinciples/logger';

const logger = createLogger({ name: 'api', level: 'info' });

await runWithCorrelationId(req.headers['x-request-id'] ?? crypto.randomUUID(), async () => {
  logger.info('handling request', { path: req.path, apiKey: req.headers.authorization });
  // apiKey is redacted automatically — the field name alone is enough.
});
```

In a browser bundle, the same import resolves to a console-backed
implementation with zero Node dependencies — no separate import path to
remember.

## Why this exists

Every service ends up needing the same three things, and getting at least one
of them wrong: logs need structure (so they're queryable, not just readable),
logs need to trace a single request across async boundaries, and logs need to
never contain a secret — however deeply nested it was.

That third one is where most logging setups quietly fail. A redaction list of
known field names catches `password` and misses `x-internal-api-key` three
levels into a proxied response body. This package redacts two ways at once:
by field name (a wide, extensible list of fragments — `token`, `secret`,
`authorization`, and friends) and by value shape (JWTs, cloud provider keys,
emails), recursively, through arrays, and through cycles without looping
forever. Redaction happens before a value ever reaches a transport, so a
custom transport that does its own JSON encoding still never sees the secret.

Correlation IDs use `AsyncLocalStorage` on Node, which is the one primitive
that actually survives `Promise.all`, timers, and `process.nextTick` — not a
convention someone has to thread through every function signature by hand.
The browser build exposes the same API for isomorphic call sites, but is
honest that it's a best-effort fallback, not equivalent isolation; see
[Notes on the design](#notes-on-the-design).

## API

| Export                                                   | Kind   | What it does                                                                                                                                          |
| -------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createLogger(options?)`                                 | fn     | Builds a `Logger`. Node: pino-backed by default. Browser: console-backed by default.                                                                  |
| `Logger#trace/debug/info/warn/error/fatal(msg, fields?)` | method | Logs at that level, redacting `fields` first. No-op below the configured `level`.                                                                     |
| `Logger#child(bindings)`                                 | method | A new `Logger` with `bindings` merged into (and overriding) the parent's base fields.                                                                 |
| `runWithCorrelationId(id, fn)`                           | fn     | Runs `fn` with `id` as the active correlation ID for its whole async extent (Node) or until it settles (browser).                                     |
| `getCorrelationId()`                                     | fn     | The active correlation ID, if any.                                                                                                                    |
| `generateCorrelationId()`                                | fn     | A fresh UUID v4.                                                                                                                                      |
| `createConsoleTransport(target?)`                        | fn     | The console-backed `Transport`, exported so Node code can opt into it instead of pino.                                                                |
| `Transport`                                              | type   | `{ name: string; write(entry: LogEntry): void }` — implement this for a custom sink.                                                                  |
| `RedactionOptions`                                       | type   | `{ keyFragments?, patterns?, replacement?, maxDepth? }` — extends the built-in redaction, or set `redaction: false` on `LoggerOptions` to disable it. |

## Recipes

### Add a request correlation ID at the edge, read it anywhere downstream

Nothing below the edge needs to know a correlation ID exists — `createLogger`
reads it from `AsyncLocalStorage` automatically on every call.

```ts
app.use((req, res, next) => {
  runWithCorrelationId(req.headers['x-request-id'] ?? generateCorrelationId(), next);
});

// three modules away, no id parameter in sight:
async function chargeCard(userId: string) {
  logger.info('charging card', { userId });
  await stripe.charges.create(/* ... */);
  logger.info('charge succeeded', { userId }); // same correlation ID, even after the await
}
```

### Ship logs somewhere other than stdout, without losing redaction

A `Transport` only ever receives the already-redacted `LogEntry` — write one
that ships to your aggregator, and the redaction guarantee holds regardless.

```ts
const httpTransport: Transport = {
  name: 'http-shipper',
  write(entry) {
    fetch('https://logs.example.com/ingest', {
      method: 'POST',
      body: JSON.stringify(entry), // entry.fields is already safe to send
    });
  },
};

const logger = createLogger({ transports: [httpTransport] });
```

### Extend redaction for a domain-specific secret shape

Built-in patterns cover JWTs, emails, and the major cloud providers' key
formats. Add your own without losing those defaults — `patterns` and
`keyFragments` are additive, never a replacement.

```ts
const logger = createLogger({
  redaction: {
    keyFragments: ['internalaccountid'],
    patterns: [/^acct_[a-z0-9]{24}$/], // your own internal account ID format
  },
});
```

## Notes on the design

- **Redaction is biased toward over-redacting.** Value-shape patterns match
  anywhere in a string, not just a full-string match — a JWT embedded in a
  longer message still gets caught, at the cost of occasionally redacting a
  string that merely looks like a secret. That trade is deliberate: a false
  positive costs a little context in a log line; a false negative is an
  incident.
- **Circular references are detected correctly, not approximately.** The
  redactor tracks only the current ancestor chain (added on the way down,
  removed on the way back up), so the same object referenced from two
  unrelated fields is redacted independently in both places, while an actual
  cycle still resolves to `[Circular]` instead of a stack overflow.
- **The browser's correlation ID is honestly a best-effort fallback, not a
  weaker version of the same guarantee.** There is no browser primitive
  equivalent to `AsyncLocalStorage` (the `AsyncContext` proposal is still
  experimental), so `runWithCorrelationId` there is backed by one shared
  variable: correct for a single in-flight async action, but two overlapping
  calls will observe each other's ID. `tests/unit/correlation-browser.test.ts`
  asserts this limitation directly rather than leaving it as a claim in a
  comment.
- **The Node/browser split is a build-time export condition, not a runtime
  check.** `src/index.ts` and `src/browser.ts` are two separate entry points;
  bundlers that understand the `browser` export condition resolve to the
  latter automatically, and `tests/integration/dist-browser.test.ts` scans the
  actual built bundle's source text for `pino`/`node:*` references so a
  regression can't silently reintroduce a Node dependency into the browser
  build.

## License

MIT
