# examples/cache-kit

Runnable usage example for [`@firstprinciples/cache-kit`](../../packages/cache-kit).

```sh
pnpm install
pnpm --filter examples-cache-kit start
```

Four scenarios, all against the in-memory backend (no Redis/Docker
needed to run this): cache-stampede protection under concurrent misses;
tag-based invalidation; a simulated cache backend outage that `wrap`
falls through cleanly instead of failing on; and a TTL actually
expiring.
