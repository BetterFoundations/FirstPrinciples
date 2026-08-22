# @firstprinciples/http-client

## 0.1.0

### Minor Changes

- bb6cc45: Initial release. A typed `fetch` wrapper: `createApiClient` returns a client
  whose `get`/`post`/`put`/`patch`/`delete` methods, and the
  endpoint-definition pattern (`client.endpoint({ method, path })`), all
  return a discriminated-union `ApiResult` — never a thrown exception for an
  expected API outcome. A network failure (`kind: 'network'`, carrying
  `@firstprinciples/core`'s new `NetworkError`) is a distinct result variant
  from a typed HTTP error response (`kind: 'http'`), which is itself distinct
  from a schema-validation failure (`kind: 'validation'`). Retry with
  exponential backoff and full jitter, retrying network failures and 5xx
  responses only, never a 4xx. Timeout via `AbortController`, correctly
  combined with a caller-supplied `signal` — whichever fires first aborts,
  the caller's signal never silently replaces the timeout. `onRequest`/
  `onResponse` hooks for auth injection and a central refresh-token pattern.
  A pluggable, dependency-free validation adapter slot (Zod/Valibot examples
  in the README, never in the package). ~2.5KB gzipped, against a 3-5KB
  target.

### Patch Changes

- Updated dependencies [bb6cc45]
  - @firstprinciples/core@0.2.0
