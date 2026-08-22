# @firstprinciples/core

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
