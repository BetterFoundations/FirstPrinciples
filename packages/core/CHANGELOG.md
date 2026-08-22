# @firstprinciples/core

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
