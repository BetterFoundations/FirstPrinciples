# examples/auth-utils

Runnable usage example for
[`@firstprinciples/auth-utils`](../../packages/auth-utils).

```sh
pnpm install
pnpm --filter examples-auth-utils start
```

Walks a real login flow — hash, verify, the no-such-user branch, and
rehash-on-login when parameters are raised — then issues an RS256 token and
verifies it.

Then it attacks itself. It mints `alg: none`, an RS256-replayed-as-HS256
forgery signed with the public key's own PEM text, expired and not-yet-valid
tokens, tokens from the wrong issuer and for the wrong audience, and a token
carrying its own `jwk` header, and prints the rejection reason for each. It
also shows the three misconfigurations that are refused at construction
rather than at request time. The script exits non-zero if any attack lands.
