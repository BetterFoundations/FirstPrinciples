# examples/core

Runnable usage example for [`@firstprinciples/core`](../../packages/core).

```sh
pnpm install
pnpm --filter examples-core start
```

Covers four scenarios end to end: a typed error union returned instead of
thrown, mapping every error to an HTTP response in one place, validating an
untrusted request body without throwing, and a `toJSON()` / `AppError.fromJSON()`
round-trip across a simulated process boundary.
