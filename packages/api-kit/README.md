# @firstprinciples/api-kit

[![npm](https://img.shields.io/npm/v/@firstprinciples/api-kit.svg)](https://www.npmjs.com/package/@firstprinciples/api-kit)
[![CI](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml/badge.svg)](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@firstprinciples/api-kit.svg)](../../LICENSE)

Backend API response conventions: a typed success/error envelope, [RFC
7807](https://www.rfc-editor.org/rfc/rfc7807) problem-details formatting of
`@firstprinciples/core` errors, schema-library-agnostic request validation,
and adapters for Express, Fastify, and Hono. ~1.6–1.9KB gzipped per entry.

A runnable version of every recipe below lives in
[`examples/api-kit`](../../examples/api-kit) —
`pnpm --filter examples-api-kit start`.

## Install

```sh
pnpm add @firstprinciples/api-kit
# plus whichever framework you use — each is an optional peer dependency
pnpm add express   # or: fastify · hono
```

## Quick start

```ts
import express from 'express';
import { NotFoundError } from '@firstprinciples/core';
import { apiKitErrorHandler, sendSuccess } from '@firstprinciples/api-kit/express';

const app = express();

app.get('/users/:id', (req, res) => {
  const user = findUser(req.params.id);
  if (!user) throw new NotFoundError(`No user ${req.params.id}`, { code: 'USER_NOT_FOUND' });
  sendSuccess(res, user);
});

app.use(apiKitErrorHandler()); // last, per Express's own convention
app.listen(3000);
```

`GET /users/42` on a hit: `{ "success": true, "data": { "id": "42", ... } }`.
On a miss: HTTP 404, `content-type: application/problem+json`,
`{ "success": false, "error": { "type": "about:blank", "title": "Not Found", "status": 404, "detail": "No user 42", "code": "USER_NOT_FOUND" } }`.

## Why this exists

Every backend in this ecosystem needs the same three things — a consistent
success/error response shape, a standards-based way to turn a thrown
`AppError` into an HTTP problem response, and request validation that
doesn't lock the project into one schema library. Hand-rolling this per
service means three services drift into three slightly different envelope
shapes, which is exactly what breaks a shared frontend client like
`@firstprinciples/react-query-kit`.

This package isn't conceptually hard on its own — the real risk is **drift
between the three framework adapters**. A `NotFoundError` has to produce
byte-identical JSON whether it's thrown from an Express route, a Fastify
handler, or a Hono handler. So the three adapters (`express.ts`, `fastify.ts`,
`hono.ts`) are thin glue over one shared, framework-free core
(`src/internal/adapter-core.ts`): every adapter's `sendSuccess`/`sendError`
calls the exact same `buildSuccessResponse`/`buildErrorResponse` functions,
so there is only one place that decides what a response looks like — drift
is structurally impossible, not just tested against. The test suite proves
this the same way: **one shared conformance suite**
(`tests/integration/conformance/conformance-suite.ts`) runs against all
three adapters, each via a real HTTP server on loopback, rather than three
separate test files that could quietly diverge from each other.

## API

| Export                                 | Kind | What it does                                                                                      |
| -------------------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| `toSuccessEnvelope(data)`              | fn   | `{ success: true, data }`.                                                                        |
| `toErrorEnvelope(error, options?)`     | fn   | `{ success: false, error: ProblemDetails }` — normalizes any thrown value.                        |
| `envelopeFromResult(result, options?)` | fn   | Builds an `ApiEnvelope` directly from a `core` `Result`.                                          |
| `toProblemDetails(error, options?)`    | fn   | Maps any thrown value to an RFC 7807 object. See [Error mapping](#error-mapping).                 |
| `runValidation(config, data)`          | fn   | Runs a `ValidateFn` against `data`, returning a `Result<T, ValidationError>` instead of throwing. |
| `ApiEnvelope<T>`                       | type | `SuccessEnvelope<T> \| ErrorEnvelope` — the wire shape of every response.                         |
| `ProblemDetails`                       | type | `{ type, title, status, detail, instance?, code, details? }`.                                     |
| `ValidateFn`                           | type | `<T>(schema: unknown, data: unknown) => T` — same shape as `http-client`'s adapter slot.          |
| `ValidationTarget`                     | type | `'body' \| 'headers' \| 'params' \| 'query'`.                                                     |

Each adapter subpath (`@firstprinciples/api-kit/express`,
`.../fastify`, `.../hono`) additionally exports `sendSuccess`, `sendError`,
`validateRequest`, and a framework-specific error-registration entry point —
`apiKitErrorHandler` (Express, Hono) or `registerApiKit` (Fastify, which has
a single `setErrorHandler` slot rather than an ordered middleware chain).
See each adapter's own TSDoc for exact signatures.

## Recipes

### Request validation, schema-library agnostic

`validateRequest` never imports Zod, Valibot, or any other library — bring
your own `ValidateFn`, the exact adapter pattern `http-client` already
established:

```ts
import { z } from 'zod';
import { validateRequest } from '@firstprinciples/api-kit/express';

const zodValidate = (schema: unknown, data: unknown) => (schema as z.ZodType).parse(data);

const CreateUser = z.object({ name: z.string().min(1) });

app.post(
  '/users',
  validateRequest({ target: 'body', schema: CreateUser, validate: zodValidate }),
  (req, res) => {
    const body = res.locals.valid.body as z.infer<typeof CreateUser>;
    sendSuccess(res, createUser(body), 201);
  },
);
```

On a failed validation, `validateRequest` calls `next(validationError)` (or
throws, on Fastify/Hono) with a `ValidationError` from `@firstprinciples/core`
— it reaches the same registered error handler as any other thrown error,
producing `{ "error": { "code": "REQUEST_VALIDATION_FAILED", "status": 400, "details": { "target": "body" } } }`.
The underlying schema library's own rejection is never echoed into the
response — only a generic message and which `target` failed, the same
"don't leak an unvetted message" rule `core`'s own parsers apply.

### Fastify

Fastify has one error-handler slot rather than an ordered middleware chain,
so wiring is a single `registerApiKit` call instead of a "register last"
convention:

```ts
import Fastify from 'fastify';
import { registerApiKit, sendSuccess, validateRequest } from '@firstprinciples/api-kit/fastify';

const app = Fastify();
registerApiKit(app); // before routes

app.get('/users/:id', async (request, reply) => {
  const user = findUser((request.params as { id: string }).id);
  if (!user) throw new NotFoundError('No such user');
  sendSuccess(reply, user);
});
```

### Hono

```ts
import { Hono } from 'hono';
import { apiKitErrorHandler, sendSuccess } from '@firstprinciples/api-kit/hono';

const app = new Hono();
app.onError(apiKitErrorHandler());

app.get('/users/:id', (c) => {
  const user = findUser(c.req.param('id'));
  if (!user) throw new NotFoundError('No such user');
  return sendSuccess(c, user);
});
```

### A dereferenceable `type` once a docs site exists

By default every `ProblemDetails.type` is `'about:blank'` — RFC 7807's own
placeholder for "no further information available". Point `typeBaseUrl` at
a real docs site once one exists and every `type` becomes a real,
dereferenceable URI built from the error's `code`:

```ts
app.use(apiKitErrorHandler({ typeBaseUrl: 'https://docs.example.com/errors' }));
// a USER_NOT_FOUND error's type becomes:
// "https://docs.example.com/errors/user-not-found"
```

### Building an envelope directly from a `Result`

For a handler that already returns a `core` `Result` rather than throwing:

```ts
import { envelopeFromResult } from '@firstprinciples/api-kit';

const result = await findUser(id); // Result<User, NotFoundError>
const envelope = envelopeFromResult(result);
res.status(envelope.success ? 200 : envelope.error.status).json(envelope);
```

## Error mapping

`toProblemDetails` builds its output from an `AppError`'s typed fields
explicitly — `code`, `httpStatus`, `message`, `details` — never by spreading
`error.toJSON()`, so a field `core` adds to that in the future can never
silently widen this public HTTP response shape.

| `ProblemDetails` field | Source                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `status`               | `error.httpStatus`                                                                                 |
| `detail`               | `error.message` — occurrence-specific ("No user 42").                                              |
| `title`                | The HTTP status's reason phrase ("Not Found") — stable across every occurrence of the same `code`. |
| `code`, `details`      | `error.code`, `error.details`, verbatim. `details` is omitted entirely when `undefined`.           |
| `type`                 | `'about:blank'`, or `${typeBaseUrl}/${code}` (kebab-cased) when configured.                        |

Anything that isn't already an `AppError` is normalized into a generic 500
(`code: 'INTERNAL_ERROR'`) with a fixed, generic `detail` — the original
error's own message is never echoed to a client, since an arbitrary caught
error (a driver failure, a library internal) was never written with a
client audience in mind, unlike an `AppError`'s message.

## Notes on the design

- **Every adapter is a thin wrapper over one shared core**
  (`src/internal/adapter-core.ts`) — this is the actual mechanism that
  prevents drift between Express, Fastify, and Hono, not just the shared
  conformance suite that verifies it.
- **Each framework is a true optional peer dependency, at the type level
  too.** `express.ts`/`fastify.ts`/`hono.ts` only ever `import type` their
  framework — never a runtime import — so a build of `@firstprinciples/api-kit`
  itself pulls in none of the three, and even the individual adapter
  subpaths carry no bundled copy of their framework (verified in
  `tests/integration/dist-bundle.test.ts`, which rebuilds `dist/` fresh
  rather than trusting a stale artifact).
- **`title` is the HTTP status's reason phrase, not the error's message.**
  RFC 7807 asks `title` to describe the problem _type_ and stay constant
  across every occurrence; an `AppError`'s `message` is written per
  occurrence ("No user 42", not "user not found"). That goes to `detail`
  instead.
- **`ValidateFn` is the exact same shape `http-client` already
  established** (`<T>(schema: unknown, data: unknown) => T`, throwing on
  failure) — one validation-adapter convention for the whole ecosystem,
  not a second one invented here.
- **A cache-miss-shaped question, resolved the same way `cache-kit` resolved
  it**: is a validation failure `Result`-shaped? `runValidation` returns
  `Result<T, ValidationError>` internally (never throwing, matching `core`'s
  convention for an _expected_, branch-worthy outcome), but at the
  HTTP-adapter boundary that `Err` becomes a thrown `ValidationError` again
  — because an adapter's error-handling entry point is the ecosystem's one
  agreed place a request-handling failure surfaces, for every kind of
  failure, not just validation.

## License

MIT
