---
'@firstprinciples/core': minor
---

Add `NetworkError`, a built-in `AppError` subclass for failures that never
reach a server — DNS failure, connection refused, timeout, or an aborted
in-flight request. Defaults: `code` `NETWORK_ERROR`, `httpStatus` 503 (the
status the failure would map to, per this package's httpStatus-is-always-set
convention). Promoted here rather than defined in `@firstprinciples/http-client`
so any future package can map a network failure without importing from
`http-client` — this is what lets `http-client`'s `ApiResult` carry a
`kind: 'network'` variant with a real, shared error class instead of an
ad hoc one.
