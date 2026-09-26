# examples/queue

Runnable usage example for [`@firstprinciples/queue`](../../packages/queue).
Needs a Redis — any local one, or `docker run -p 6379:6379 redis:7-alpine`.

```sh
pnpm install
REDIS_URL=redis://localhost:6379 pnpm --filter examples-queue start
```

Five scenarios against a real Redis: a typed job whose typed result comes
back from `job.result()`; a flaky job retried with backoff until it
succeeds; a job whose downstream is down exhausting its attempts and landing
in the dead-letter queue with its reason, attempt count and last error; a
malformed payload from a producer that skipped validation dead-lettered
after a single attempt without reaching its handler; and, once the
downstream recovers, the dead-lettered job redriven to success. Cleans up
its queues afterwards.
