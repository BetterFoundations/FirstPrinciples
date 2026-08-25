# @firstprinciples/core

## 0.3.0

### Minor Changes

- c11e17b: Separate the error taxonomy discriminant (`kind`) from the per-class
  identity (`name`), so the built-in error classes can be subclassed.

  **Breaking**, against `0.1.0`: `NotFoundError['name']` and its siblings
  are now `string` rather than their own string literal, and the literal
  lives on a new `kind` field. `switch (error.name)` over the built-ins
  becomes `switch (error.kind)`. Runtime `name` values are unchanged.
  `toJSON` gains `kind`, and `fromJSON` requires it to reconstruct a
  subclass. Taken as a `minor` because the ecosystem is pre-1.0 and nothing
  consumes these packages yet.

  **Why.** One property was doing two contradictory jobs. A taxonomy slot
  must stay fixed in a subclass, so `switch` stays exhaustive and a
  `ConflictError` is not assignable to a `NotFoundError`. A class identity
  must vary, so an error reports itself correctly in a log. Putting both on
  `name` made the built-ins mutually distinct and, as a side effect,
  **unsubclassable** — a subclass declaring its own literal `name` is not
  assignable to its parent's. `auth-utils` hit this first and had to extend
  `AppError` directly, losing `instanceof UnauthorizedError`.

  - **`kind`** is the literal, `readonly`, and the thing to `switch` on.
    Subclasses inherit it unchanged — a `JwtVerificationError extends
UnauthorizedError` reports `kind: 'UnauthorizedError'`, which is the
    correct answer for anything switching on the taxonomy. Were a subclass
    free to set its own, every existing exhaustive switch would silently
    start falling through to `default` the moment one was defined.
  - **`name`** is `string` everywhere, free for a subclass to narrow to its
    own literal, and still what appears in logs and stack traces.

  **Two alternatives were tried with `tsc` first, and both were rejected.**
  A generic `name` parameter (`class UnauthorizedError<TName extends string
= 'UnauthorizedError'>`) satisfies everything on paper, but `instanceof`
  instantiates a generic class at `any` — inside
  `if (e instanceof UnauthorizedError)`, `e.name.toFixed(2)` compiles. That
  is the same trap that kept `details` non-generic, on the field people
  actually log. A `unique symbol` brand narrows correctly but gives up
  `switch` exhaustiveness for nothing this design does not already give.

  **`fromJSON` picks a class from `kind` alone**, never from `name`. It
  parses untrusted input, so a payload must not be able to name its own
  class, and a payload whose `kind` and `name` disagree must not resolve by
  a fallback order nobody would think to check. An absent or unrecognized
  `kind` yields a plain `AppError`; `name` is carried through as data.

  HTTP responses are unaffected: `api-kit` builds RFC 7807 problem details
  from an explicit field list and never spreads `toJSON()`.

## 0.2.0

### Minor Changes

- bb6cc45: Add `NetworkError`, a built-in `AppError` subclass for failures that never
  reach a server — DNS failure, connection refused, timeout, or an aborted
  in-flight request. Defaults: `code` `NETWORK_ERROR`, `httpStatus` 503 (the
  status the failure would map to, per this package's httpStatus-is-always-set
  convention). Promoted here rather than defined in `@firstprinciples/http-client`
  so any future package can map a network failure without importing from
  `http-client` — this is what lets `http-client`'s `ApiResult` carry a
  `kind: 'network'` variant with a real, shared error class instead of an
  ad hoc one.

## 0.1.1

### Patch Changes

- 048f7a8: README now links to the runnable usage example in `examples/core`.

## 0.1.0

### Minor Changes

- b16933f: Initial release. Typed error hierarchy (`AppError` plus `ValidationError`,
  `NotFoundError`, `ForbiddenError`, `UnauthorizedError`, `ConflictError`), each
  carrying `code`, `httpStatus` and `details`, with a lossless `toJSON()` /
  `AppError.fromJSON()` round-trip that deliberately omits stack traces.
  `Result<T, E>` with `ok`/`err` constructors and `isOk`/`isErr` guards, defaulting
  its error type to `AppError`. Branded primitives `Email`, `UUID` and
  `ISODateString` whose validators return a `Result` rather than throwing. Zero
  runtime dependencies.
