# @firstprinciples/auth-utils

## 0.1.0

### Minor Changes

- e869d90: Add `@firstprinciples/auth-utils` — argon2id password hashing and JWT
  issue/verify behind a mandatory algorithm allowlist.

  **Password hashing.** `hashPassword` / `verifyPassword` /
  `passwordNeedsRehash` / `verifyPasswordDecoy` over the `argon2` native
  binding (a peer dependency, so the binary matches your Node ABI and you
  can patch it without waiting on a release here). Defaults are m=19456
  KiB, t=2, p=1 — OWASP's argon2id minimum, chosen from measurements rather
  than copied, with the reasoning and the numbers in the README.
  Verification is constant-time on both axes that matter: the digest
  comparison (`argon2.verify` ends in `crypto.timingSafeEqual`) and the
  control flow around it, where an unusable stored hash still costs a full
  derivation so a corrupted row or a locked account cannot be identified by
  timing.

  **JWT.** `createJwtSigner` / `createJwtVerifier` over `jose`, with the
  allowlist required rather than optional and validated against the key at
  construction time. A verifier refuses to build if the allowlist is empty,
  mixes symmetric and asymmetric algorithms, disagrees with the key, is
  handed a PEM document as an HMAC secret, or gets an HS256 secret below
  RFC 7518 §3.2's minimum. `exp`, `iss` and `aud` are all required by
  default; clock tolerance defaults to 0 and is capped at 300s. `verify`
  returns a `Result`, never throws.

  `tests/attacks/` carries a working exploit for each of `alg: none`,
  RS256-replayed-as-HS256 algorithm confusion, expired and not-yet-valid
  tokens, wrong issuer, wrong audience, and header key-injection — two of
  which land against `jose` driven the ordinary way, which is why the
  package's checks are where they are.

- e869d90: Add refresh-token rotation with reuse detection, and login-attempt rate
  limiting, both over a bring-your-own store with an in-memory default.

  **Rotation is atomic**, with no instant where both the presented token
  and its successor are valid, and none where neither is. That comes from
  the data model rather than from a distributed transaction: a token
  _family_ is one record, so invalidating the old token and issuing the new
  one are edits to the same object and reach the store as a single write.
  What remains is an ordinary read-modify-write race, handled with
  compare-and-set — chosen over a lock because a lock needs a lease, and a
  lease needs a correct answer to "what if the holder stalls past it".

  **Replaying a rotated token revokes the entire family.** The server
  cannot tell which of two holders is legitimate — the attacker may be the
  one holding the _current_ token — so every token descended from that
  login dies. Revoking only the replayed token is the half-implementation
  that provides no security benefit.

  Two clients presenting the same token concurrently resolve strictly: one
  rotation succeeds, the loser retries, sees a rotated token and revokes
  the family. `reused` fires **exactly once per family**, at detection;
  later replays report `revoked`, so one incident is one alert. There is
  deliberately no grace window for double-submits — implementing one means
  returning the same successor to a repeated request, which means storing
  that successor in plaintext.

  Tokens are opaque and stored only as a SHA-256 digest. Not argon2id:
  that cost exists to make _guessing_ expensive, and a 256-bit random value
  cannot be guessed, so stretching it would put ~24 ms on every refresh and
  buy nothing.

  **The rate limiter fails closed when its store fails** — deliberately the
  opposite call to `cache-kit`'s `wrap`, which swallows backend errors
  because a cache must not become a new failure mode. A limiter is a
  control: failing open means whoever can knock over the store has bought
  unlimited password guesses. `onStoreError: 'allow'` opts out.

  New: `createRefreshTokenService`, `createLoginRateLimiter`,
  `createMemoryRefreshTokenStore`, `createMemoryAttemptStore`,
  `RefreshTokenError`, `RefreshTokenStoreError`, `RateLimitStoreError`, and
  the `RefreshTokenStore` / `AttemptStore` contracts.

### Patch Changes

- Updated dependencies [c11e17b]
  - @firstprinciples/core@0.3.0
