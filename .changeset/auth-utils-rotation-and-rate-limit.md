---
'@firstprinciples/auth-utils': minor
---

Add refresh-token rotation with reuse detection, and login-attempt rate
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
