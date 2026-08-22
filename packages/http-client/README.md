# @firstprinciples/http-client

[![npm](https://img.shields.io/npm/v/@firstprinciples/http-client.svg)](https://www.npmjs.com/package/@firstprinciples/http-client)
[![CI](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml/badge.svg)](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@firstprinciples/http-client.svg)](../../LICENSE)

A typed `fetch` wrapper: every request returns a discriminated-union
`ApiResult`, never a thrown exception. Built directly on native `fetch` — no
axios, no XHR. ~2.5KB gzipped.

A runnable version of every recipe below lives in
[`examples/http-client`](../../examples/http-client) —
`pnpm --filter examples-http-client start`.

## Install

```sh
pnpm add @firstprinciples/http-client
```

## Quick start

```ts
import { createApiClient } from '@firstprinciples/http-client';

interface User {
  id: string;
  name: string;
}

const client = createApiClient({ baseUrl: 'https://api.example.com' });
const result = await client.get<User>('/users/123');

if (result.ok) {
  console.log(result.value.name);
} else {
  // result.kind is 'network' | 'http' | 'validation'
  console.error(result.kind, result.error.message);
}
```

## Why this exists

Most fetch wrappers throw for an HTTP error response, which means every
call site needs a `try`/`catch` to handle an _expected_ outcome — a 404 is
not a bug, it is data. `ApiResult` makes that outcome part of the type: a
caller narrows `result.ok` and the compiler holds them to it.

The result carries the ecosystem's shared error taxonomy from
[`@firstprinciples/core`](../core) — `NotFoundError`, `ValidationError`, and
the rest — so an error from this package and an error from
`@firstprinciples/access-control` or `@firstprinciples/api-kit` share one
`code` / `httpStatus` / `details` shape.

Three things this package is deliberately careful about, because each is
easy to get subtly wrong in a way that still looks like it works:

- **A network failure is not an HTTP error.** A DNS failure, a dropped
  connection, or a timeout never reached a server at all — that's `kind:
'network'`, with `status: undefined` and a `NetworkError`. A 404 or 500
  did reach a server — that's `kind: 'http'`, with the real status and a
  mapped error class. Conflating the two means a caller can't tell "show a
  retry button" from "show an error message."
- **A caller-supplied `AbortSignal` is combined with the internal timeout,
  never replaces it.** Pass your own `signal` and the request still aborts
  at the configured timeout if your signal never fires — whichever fires
  first wins.
- **The default retry policy never retries a 4xx.** Only network failures
  and 5xx responses are retried, with exponential backoff and full jitter
  so a fleet of clients doesn't retry in lockstep.

## API

| Export                             | Kind   | What it does                                                                                            |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `createApiClient(config)`          | fn     | Builds an `ApiClient` bound to a `baseUrl`.                                                             |
| `client.get/post/put/patch/delete` | method | Issues a request. Returns `Promise<ApiResult<T, E>>` — never throws for an expected API outcome.        |
| `client.endpoint(definition)`      | method | Builds a reusable, pre-typed request function — see [Recipes](#recipes) below.                          |
| `ApiResult<T, E>`                  | type   | `ApiOk<T> \| ApiErr<E>` — `ok`, `status`, and (on failure) `kind: 'http' \| 'network' \| 'validation'`. |
| `RequestOptions`                   | type   | `{ headers?, timeoutMs?, retry?, signal?, schema? }` — per-call overrides.                              |
| `RetryConfig`                      | type   | `{ attempts?, backoffMs?, retryOn? }` — see [Retry](#retry-behavior).                                   |
| `ValidateFn`                       | type   | `<T>(schema: unknown, data: unknown) => T` — the pluggable validation adapter slot.                     |

## Recipes

### The endpoint-definition pattern

Bakes the method, path, and generics into one reusable function, so call
sites don't repeat them:

```ts
const getUser = client.endpoint<User>({ method: 'GET', path: '/users/:id' });
const result = await getUser({ id: '123' });

const createUser = client.endpoint<User>({ method: 'POST', path: '/users' });
await createUser({}, { body: { name: 'Ada' } });
```

### Inject an auth token on every request

```ts
const client = createApiClient({
  baseUrl: 'https://api.example.com',
  onRequest: (context) => {
    context.headers['authorization'] = `Bearer ${getToken()}`;
    return context;
  },
});
```

### A 401 → refresh token → retry pattern

`onResponse` sees the raw response before it's parsed, and can replace it —
this is the hook to implement a central refresh flow in:

```ts
const client = createApiClient({
  baseUrl: 'https://api.example.com',
  onResponse: async (context) => {
    if (context.response.status !== 401) return context;
    await refreshAccessToken();
    // Re-issue the original request directly — not through this client's
    // own retry policy, to avoid recursing through it.
    const retried = await fetch(context.request.url, {
      method: context.request.method,
      headers: { ...context.request.headers, authorization: `Bearer ${getToken()}` },
      body: context.request.body,
    });
    return { ...context, response: retried };
  },
});
```

### Validate a response with Zod or Valibot

The validation adapter is a pluggable slot, not a dependency — this package
never imports a schema library itself.

```ts
// Zod
import { z } from 'zod';

const client = createApiClient({
  baseUrl: 'https://api.example.com',
  validate: (schema, data) => (schema as z.ZodType).parse(data),
});

const UserSchema = z.object({ id: z.string(), name: z.string() });
const result = await client.get<User>('/users/1', { schema: UserSchema });
// result is `kind: 'validation'` on a failed parse, never a thrown ZodError.
```

```ts
// Valibot
import * as v from 'valibot';

const client = createApiClient({
  baseUrl: 'https://api.example.com',
  validate: (schema, data) => v.parse(schema as v.BaseSchema, data),
});
```

### Override retry per call, or disable it

```ts
await client.get('/users/1', { retry: false });
await client.get('/reports/slow', { timeoutMs: 60_000, retry: { attempts: 1 } });
```

## Retry behavior

Default policy: **2 total attempts** (one retry), backing off with full
jitter — a random delay drawn from `[0, backoffMs * 2^attempt]`, base
`backoffMs: 200`. Retried: `kind: 'network'` failures and `kind: 'http'`
failures with `status >= 500`. **Never retried:** any 4xx response, or a
`kind: 'validation'` failure — neither would produce a different outcome on
a second try. Override `retryOn` on the client or per call for a custom
policy.

## Notes on the design

- **`ApiResult` is `core`'s `Result<T, E>` widened with transport
  metadata**, not a separate result type — `ApiOk<T> = Ok<T> & { status }`,
  `ApiErr<E> = Err<E> & { status, kind }`. `core`'s own `isOk`/`isErr` narrow
  it without losing `status` or `kind`, and it stays assignable back to a
  plain `Result` for a caller that doesn't care about transport detail. See
  the `core`/`http-client` layering decision in this repo's
  `EXECUTION-CHECKLIST.md`.
- **A network failure carries a `NetworkError`** — promoted into `core`
  rather than defined here, so any future package can map a network failure
  without depending on `http-client`. `httpStatus` is 503 even though no
  HTTP response was ever received: `core`'s convention is that every error
  sets the status it _would_ map to.
- **The timeout/abort combination only ever has two possible signal
  sources**: the internal timeout `AbortController`, and an optional
  caller-supplied signal. They're combined into one signal that aborts on
  whichever fires first, with listeners detached and the timer cleared once
  the attempt settles — a long-lived caller signal reused across many
  requests never accumulates listeners.
- **`endpoint()`'s returned function is `async`, deliberately** — a missing
  path parameter (`getUser()` when the endpoint needs `:id`) throws
  synchronously inside `interpolatePath`, which is a caller bug, not an
  expected API outcome; marking the function `async` normalizes that throw
  into a rejected promise regardless of whether the caller uses `await` or
  `.then()`.
- **A response body is parsed once, based on `content-type`.** A `204`/`205`
  or zero-length body becomes `undefined`. A `content-type:
application/json` body that fails to parse is handed back as raw text
  rather than throwing — a malformed body is a server bug the caller should
  see, not a crash in this client.

## License

MIT
