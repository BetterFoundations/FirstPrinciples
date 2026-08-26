# examples/access-control

Runnable usage example for
[`@firstprinciples/access-control`](../../packages/access-control).

```sh
pnpm install
pnpm --filter examples-access-control start
```

One policy, three consumers, in one script:

1. **The engine directly** — ownership grants, an explicit deny outranking the
   admin wildcard, and the two fail-closed cases (no resource in hand, and a
   resource with no owner).
2. **A real Express server on loopback**, guarded by `createExpressGuard`, hit
   with `fetch` so you can see the 200s and 403s.
3. **The browser's view**, built by serializing the policy to JSON, parsing it
   back with `parsePolicy`, and rendering `<Can>` through `react-dom/server` —
   the same decisions the server just made, from the same bytes.

The React parts use `createElement` rather than JSX so the file runs under
`node src/index.ts` with no build step.
