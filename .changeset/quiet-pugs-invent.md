---
'@firstprinciples/core': minor
---

Initial release. Typed error hierarchy (`AppError` plus `ValidationError`,
`NotFoundError`, `ForbiddenError`, `UnauthorizedError`, `ConflictError`), each
carrying `code`, `httpStatus` and `details`, with a lossless `toJSON()` /
`AppError.fromJSON()` round-trip that deliberately omits stack traces.
`Result<T, E>` with `ok`/`err` constructors and `isOk`/`isErr` guards, defaulting
its error type to `AppError`. Branded primitives `Email`, `UUID` and
`ISODateString` whose validators return a `Result` rather than throwing. Zero
runtime dependencies.
