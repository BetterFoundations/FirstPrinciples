# @firstprinciples/core

[![npm](https://img.shields.io/npm/v/@firstprinciples/core.svg)](https://www.npmjs.com/package/@firstprinciples/core)
[![CI](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml/badge.svg)](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@firstprinciples/core.svg)](../../LICENSE)

A typed error hierarchy, a `Result` type, and branded primitives. Zero runtime
dependencies, isomorphic, 1.6 kB minified and brotlied.

Every other `@firstprinciples` package imports from here, so this one stays
small enough that depending on it is never a decision you have to think about.

A runnable version of every recipe below lives in
[`examples/core`](../../examples/core) — `pnpm --filter examples-core start`.

## Install

```sh
pnpm add @firstprinciples/core
```

## Quick start

```ts
import {
  err,
  isErr,
  isOk,
  NotFoundError,
  ok,
  parseUUID,
  type Result,
  type UUID,
} from '@firstprinciples/core';

async function getUser(rawId: string): Promise<Result<User, NotFoundError | ValidationError>> {
  const id = parseUUID(rawId);
  if (isErr(id)) return id; // a narrow Err widens into the union, no re-wrap

  const user = await db.users.find(id.value);
  if (!user) return err(new NotFoundError(`No user ${rawId}`, { code: 'USER_NOT_FOUND' }));

  return ok(user);
}

const result = await getUser(req.params.id);
if (isOk(result)) {
  reply.send(result.value);
} else {
  reply.status(result.error.httpStatus).send(result.error.toJSON());
}
```

## Why this exists

Two things go wrong in a TypeScript codebase that has grown past one service.

**Errors stop carrying information.** Every layer invents its own error shape,
so the HTTP boundary ends up with a chain of `instanceof` checks against
classes from four different modules, and the status code is decided by string
matching on a message. `AppError` fixes the shape once: `code` for machines,
`httpStatus` for the transport, `details` for context, `cause` for the chain.
One mapping at the boundary then covers everything.

**Expected failures get thrown.** A user not being found is not exceptional; it
is one of two normal outcomes, and the type system should say so. `Result<T, E>`
makes that outcome visible in the signature, so the compiler can tell you about
the branch you forgot.

The two compose on purpose: `Result<T>` defaults its error type to `AppError`,
so a caller gets exhaustive narrowing from the discriminated union _and_ the
shared taxonomy, without picking one over the other.

Nothing here throws. Errors are values you construct and hand back; even
`AppError.fromJSON`, which parses untrusted input, returns a `Result`.

## API

| Export                                            | Kind   | What it does                                                                                                     |
| ------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| `AppError`                                        | class  | Base error: `code`, `httpStatus`, `details`, native `cause`. Concrete — also the generic `INTERNAL_ERROR` / 500. |
| `ValidationError`                                 | class  | Input failed validation. `VALIDATION_ERROR` / 400.                                                               |
| `NotFoundError`                                   | class  | Resource does not exist. `NOT_FOUND` / 404.                                                                      |
| `ForbiddenError`                                  | class  | Authenticated but not allowed. `FORBIDDEN` / 403.                                                                |
| `UnauthorizedError`                               | class  | Not authenticated. `UNAUTHORIZED` / 401.                                                                         |
| `ConflictError`                                   | class  | Conflicts with current state. `CONFLICT` / 409.                                                                  |
| `AppError#toJSON()`                               | method | Serializes name, kind, code, httpStatus, message, details and the whole cause chain. **Never a stack.**          |
| `AppError.fromJSON(value)`                        | static | Rebuilds an error from untrusted JSON. Returns `Result<AppError, ValidationError>`.                              |
| `isAppError(value)`                               | guard  | Brand check that works across duplicate copies of this package, where `instanceof` cannot.                       |
| `Result<T, E>`                                    | type   | `Ok<T> \| Err<E>`. `E` defaults to `AppError`.                                                                   |
| `ok(value?)` / `err(error)`                       | fn     | Construct each branch. `ok()` gives `Ok<void>`.                                                                  |
| `isOk(r)` / `isErr(r)`                            | guard  | Narrow both branches. Usable as standalone predicates.                                                           |
| `Brand<T, B>`                                     | type   | Tag a primitive so it stops being interchangeable. Erased at runtime.                                            |
| `Email` / `UUID` / `ISODateString`                | type   | Branded strings.                                                                                                 |
| `isEmail` / `isUUID` / `isISODateString`          | guard  | Narrow an `unknown` straight to the brand.                                                                       |
| `parseEmail` / `parseUUID` / `parseISODateString` | fn     | Validate, returning a `Result` with a typed reason.                                                              |

## Recipes

### Map every error to an HTTP response in one place

`httpStatus` is on the base class, so the boundary needs no knowledge of which
subclass it is holding. `toJSON()` deliberately omits the stack, so this is
safe even though `JSON.stringify` calls it implicitly.

```ts
app.use((error: unknown, _req, res, next) => {
  if (!isAppError(error)) return next(error);
  logger.error({ err: error }, error.message); // the stack is still on error.stack
  res.status(error.httpStatus).json(error.toJSON());
});
```

### Wrap a lower-level failure without losing it

`cause` is typed `unknown`, which is exactly what a `catch` binding gives you —
no cast at the call site. The original error, and its stack, stay reachable.

```ts
try {
  await db.insert(user);
} catch (cause) {
  throw new ConflictError('Email already registered', {
    code: 'EMAIL_TAKEN',
    details: { field: 'email' },
    cause,
  });
}
```

### Validate a request body without throwing

Each parser short-circuits, and a narrower `Err` widens into a wider signature
on its own, so there is no re-wrapping ceremony.

```ts
function parseSignup(body: Record<string, unknown>): Result<Signup, ValidationError> {
  const email = parseEmail(body.email);
  if (isErr(email)) return email;

  const invitedAt = parseISODateString(body.invitedAt);
  if (isErr(invitedAt)) return invitedAt;

  return ok({ email: email.value, invitedAt: invitedAt.value });
}
```

Rejections say _why_ without echoing the value — an address or token is exactly
the sort of thing that should not be copied into a payload that may be logged:

```ts
const email = parseEmail(input);
if (isErr(email)) {
  switch (email.error.details?.reason) {
    case 'too-long':
      return 'That address is too long.';
    default:
      return 'That does not look like an email address.';
  }
}
```

## Notes on the design

A few decisions here are deliberate and worth knowing about.

- **`toJSON()` carries no stack.** `JSON.stringify` calls `toJSON` implicitly,
  so this is the shape that reaches a response body the moment anyone writes
  `res.json(error)`. Stacks stay on `error.stack` and along `error.cause`,
  which is where a logger reads them anyway.
- **`details` is `unknown`, not a type parameter.** A generic `AppError<T>`
  reads well at the construction site, then instantiates at `any` under
  `instanceof` narrowing — handing back unchecked data at precisely the
  boundary where untyped data arrives. A function that does know the shape can
  still say so in its return type; see `BrandValidationError`.
- **`kind` is the discriminant; `name` is free.** `kind` is a string literal on
  each built-in — the subclasses add no other members, so without a literal
  somewhere TypeScript, being structural, would consider a `ConflictError`
  assignable to a `NotFoundError`. It also makes `switch (error.kind)`
  exhaustive.

  `name` was that literal until 0.2.0, and doing both jobs with one property
  made the built-ins **unsubclassable**: `declare name: 'JwtVerificationError'`
  is not assignable to `'UnauthorizedError'`, so a downstream package could not
  extend `UnauthorizedError` and still report its own name. They are two
  properties now — see _Subclassing a built-in error_ below.

- **Parsers do not normalize.** `parseUUID` accepts uppercase and returns it
  unchanged; a `parse` that silently rewrites its input surprises callers who
  compare strings.
- **`ISODateString` validates the calendar, not just the shape.**
  `new Date('2026-02-31T00:00:00Z')` does not fail — it rolls over to 3 March.

## Subclassing a built-in error

Extend the built-in whose taxonomy slot you belong in, declare your own `name`,
and leave `kind` alone:

```ts
import { UnauthorizedError } from '@firstprinciples/core';

export class JwtVerificationError extends UnauthorizedError {
  declare name: 'JwtVerificationError';
  declare readonly details: { readonly reason: 'expired' | 'signature_invalid' };

  constructor(reason: 'expired' | 'signature_invalid', message: string) {
    super(message, { code: `JWT_${reason.toUpperCase()}`, details: { reason } });
    this.name = 'JwtVerificationError';
  }
}
```

You get `instanceof UnauthorizedError`, the 401, and `api-kit`'s RFC 7807
rendering for free. `kind` stays `'UnauthorizedError'` — deliberately, because
anything switching on the taxonomy should treat your error as what it is. Your
own identity lives in `name`, and narrowing `details` follows the same pattern
`BrandValidationError` uses.

`fromJSON` picks the class from `kind` and nothing else, so a serialized
`JwtVerificationError` revives as a real `UnauthorizedError` carrying its
original `name` — the right taxonomy and the right status. `instanceof
YourSubclass` still cannot survive the round trip, since this package has no
way to know your class.

`name` is never used to select a class. It is data: `fromJSON` parses untrusted
input, and letting a payload name its own class — or letting a payload whose
`kind` and `name` disagree resolve by some fallback order — is not a decision
worth leaving implicit.

## License

MIT
