# examples/http-client

Runnable usage example for [`@firstprinciples/http-client`](../../packages/http-client).

```sh
pnpm install
pnpm --filter examples-http-client start
```

Spins up a tiny local HTTP server (no network access needed) and covers four
scenarios end to end: a successful request via the endpoint-definition
pattern; a network failure and a typed HTTP error arriving as distinct
`ApiResult` variants; a transient failure recovering via the default retry
policy; and `onRequest` injecting an auth header the server actually
receives.
