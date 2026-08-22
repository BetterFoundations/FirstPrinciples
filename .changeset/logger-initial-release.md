---
'@firstprinciples/logger': minor
---

Initial release. Structured, isomorphic logging: `createLogger` wraps pino on
Node with a zero-dependency console fallback in the browser (resolved via the
`browser` export condition — verified to pull in neither pino nor a Node
built-in). Automatic secret/PII redaction by both field name and value shape
(JWTs, cloud provider API keys, emails), recursive through nested
objects/arrays with correct cycle detection, applied before any transport
ever sees a value. Request-correlation IDs via `AsyncLocalStorage` on Node,
propagating across `await`, `Promise.all`, and timers; a documented
best-effort fallback in the browser. Pluggable `Transport` interface.
