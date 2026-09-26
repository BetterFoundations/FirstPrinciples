# examples/bootstrap

Runnable usage example for [`@firstprinciples/bootstrap`](../../packages/bootstrap).

```sh
pnpm install
pnpm --filter examples-bootstrap start
```

Runs a real service lifecycle end to end: an invalid environment rejected with
every problem named at once; a valid one starting a fake database and then a
real `node:http` server; three slow requests in flight when the process sends
itself a real `SIGTERM`; `/readyz` failing from the moment the drain begins;
all three requests answered with the database still open; the database closed
only after the server finished draining; and `exit(0)`.
