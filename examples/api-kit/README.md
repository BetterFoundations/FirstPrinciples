# examples/api-kit

Runnable usage example for [`@firstprinciples/api-kit`](../../packages/api-kit) (Express adapter).

```sh
pnpm install
pnpm --filter examples-api-kit start
```

Spins up a real Express server on loopback and covers four scenarios end to
end: a success envelope; a thrown `NotFoundError` mapped to an RFC 7807
problem-details error envelope; request validation, both passing and
failing, without importing any schema library; and an unexpected throw
normalized without leaking its own message. The Fastify and Hono adapters
work identically — see the package README's own recipes for those.
