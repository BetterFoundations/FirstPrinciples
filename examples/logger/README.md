# examples/logger

Runnable usage example for [`@firstprinciples/logger`](../../packages/logger).

```sh
pnpm install
pnpm --filter examples-logger start
```

Covers three scenarios end to end: a correlation ID that survives an `await`,
a timer, and a `Promise.all` fan-out with no manual threading; a secret
nested three levels deep getting redacted automatically by value shape, not
just by key name; and a custom transport confirming it only ever receives an
already-redacted entry.
