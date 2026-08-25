# @firstprinciples/auth-utils

[![npm](https://img.shields.io/npm/v/@firstprinciples/auth-utils.svg)](https://www.npmjs.com/package/@firstprinciples/auth-utils)
[![CI](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml/badge.svg)](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@firstprinciples/auth-utils.svg)](../../LICENSE)

argon2id password hashing with parameters that are justified rather than
copied; JWT issue/verify behind a **mandatory algorithm allowlist** validated
against your key at construction time; and refresh-token rotation whose
reuse detection revokes the whole family. ~6.9 kB gzipped, or ~4.1 kB for the
token-only entry point.

A runnable version of every recipe below lives in
[`examples/auth-utils`](../../examples/auth-utils) —
`pnpm --filter examples-auth-utils start`.

## Install

```sh
pnpm add @firstprinciples/auth-utils argon2
```

`argon2` is a peer dependency, not a bundled one: it is a native binding, and
the binary has to match your Node ABI and platform. Owning it directly also
means you can patch a CVE in it without waiting on a release here.

If you only need tokens — an edge function verifying a JWT, say — import
`@firstprinciples/auth-utils/jwt` instead. That entry point is pure
JavaScript, touches no Node built-ins, and needs no `argon2` at all.

## Quick start

```ts
import {
  createJwtSigner,
  createJwtVerifier,
  hashPassword,
  verifyPassword,
  verifyPasswordDecoy,
} from '@firstprinciples/auth-utils';
import { isOk } from '@firstprinciples/core';

// --- registration ---
const passwordHash = await hashPassword(password); // store this string as-is

// --- login ---
const user = await users.findByEmail(email);
const valid = user
  ? await verifyPassword(user.passwordHash, password)
  : await verifyPasswordDecoy(password); // same work, so timing says nothing

if (!valid) return unauthorized();

// --- issuing a token ---
const signer = createJwtSigner({
  algorithm: 'RS256',
  key: privateKey,
  issuer: 'https://auth.example.com',
  audience: 'https://api.example.com',
  ttlSeconds: 900,
});
const token = await signer.sign({ sub: user.id, role: user.role });

// --- verifying one ---
const verifier = createJwtVerifier({
  algorithms: ['RS256'], // required. there is no default, on purpose
  key: publicKey,
  issuer: 'https://auth.example.com',
  audience: 'https://api.example.com',
});

const result = await verifier.verify(token);
if (isOk(result)) {
  console.log(result.value.claims.sub);
} else {
  console.log(result.error.reason); // 'expired' | 'signature_invalid' | ...
}
```

## Why this exists

`jose`, which this package builds on, is a careful library. It is not
vulnerable to the classic JWT attacks — when you drive it correctly.

The problem is that driving it incorrectly looks completely reasonable. Two
attacks in this package's test suite **land against `jose` itself**, and both
are reproduced as passing tests in
[`tests/attacks/`](tests/attacks) so the claim can be checked rather than
believed:

**1. Algorithm confusion.** `jose`'s `algorithms` option is optional, and when
you omit it the default is _every algorithm the supplied key supports_. Load
your RSA public key the obvious way —

```ts
const key = fs.readFileSync('public.pem'); // a Buffer, which is a Uint8Array
await jwtVerify(token, key); // no `algorithms` option
```

— and `jose` reads those bytes as an HMAC secret. An attacker takes your
public key (it is public), signs `{"alg":"HS256"}` with its PEM text as the
secret, and you accept their claims. Verified in
[`algorithm-confusion.test.ts`](tests/attacks/algorithm-confusion.test.ts).

**2. Tokens that never expire.** `jose` does not require `exp`. A token minted
without one verifies forever. Verified in
[`claims.test.ts`](tests/attacks/claims.test.ts).

Both are _configuration_ vulnerabilities, not implementation bugs. So the
fix here is not more runtime checking — it is making the unsafe
configuration unrepresentable, and checking what remains at construction
time, where it fails at startup instead of on whichever request first reaches
the bad path.

## What the allowlist actually enforces

`createJwtVerifier` refuses to build at all if:

| Configuration                      | Why it is refused                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `algorithms` omitted or empty      | `jose`'s default is every algorithm the key supports                                                                        |
| `algorithms: ['none']`             | not a signature algorithm; rejected even past a cast                                                                        |
| `algorithms: ['RS256', 'HS256']`   | one verifier holds one key, and a key that verifies an HMAC can forge one — this mix is the confusion attack's precondition |
| an RSA public key with `['HS256']` | same, one step later                                                                                                        |
| raw bytes with `['RS256']`         | `jose` would read them as an HMAC secret                                                                                    |
| a `Uint8Array` starting `-----`    | that is a PEM file being passed as a secret: the attack primitive itself                                                    |
| an HS256 secret under 32 bytes     | RFC 7518 §3.2; brute-forceable offline from one captured token                                                              |
| a _private_ key on a verifier      | a verifier needs the public half                                                                                            |
| `clockToleranceSeconds > 300`      | tolerance extends every expired token's life by exactly that much                                                           |

And at verify time, before any signature check, a token is rejected if its
header carries `jwk`, `jku`, `x5u`, `x5c`, or an unrecognized `crit` — all of
which would let the token nominate the key that validates it.

Defaults that differ from `jose`'s, deliberately:

- **`exp` is required.** Opt out with `requireExpiration: false`.
- **`issuer` and `audience` are required** by the type, not optional. An
  unchecked audience accepts another service's tokens for the same issuer.
- **Clock tolerance is 0**, and capped at 300 seconds.
- **`verify` returns a `Result`, never throws.** A rejected token is the most
  ordinary outcome of serving untrusted traffic; a `Result` puts handling it
  in the type, where a `try`/`catch` lets you forget it invisibly.

## Choosing argon2id parameters

The default is **m=19456 KiB (19 MiB), t=2, p=1** — OWASP's argon2id minimum.
Here is the reasoning, and the measurements it came from (Apple M2, Node
24.19.0, median of 7):

| Configuration                                                  | Time     | Memory per concurrent login |
| -------------------------------------------------------------- | -------- | --------------------------- |
| `m=19456 t=2 p=1` (this default)                               | 24 ms    | 19 MiB                      |
| `m=47104 t=1 p=1`                                              | 25 ms    | 46 MiB                      |
| `m=65536 t=3 p=1` (RFC 9106 #2, `argon2`'s own default at p=1) | 120 ms   | 64 MiB                      |
| `m=65536 t=3 p=4`                                              | 34–64 ms | 64 MiB                      |

**Memory is the only parameter that buys asymmetric defence.** An attacker
cracking stolen hashes wins by running guesses in parallel, and memory —
capacity and bandwidth — is what limits how many, because it is the resource
a GPU or ASIC cannot multiply cheaply. Raising `t` costs attacker and
defender the same multiple. Raising `m` costs the attacker _per parallel
guess_. Buy memory first.

**`parallelism` buys nothing against an attacker.** Lanes split one
derivation across cores; an attacker parallelises across guesses regardless.
Look at the last two rows: `p=4` cuts wall time by ~3.5× at _identical_
attacker cost. It is a defender-side latency knob only. `p=1` is the default
because it makes latency predictable — the `p=4` figures varied 2× run to run
under threadpool contention — and keeps one login on one of libuv's four
default threadpool slots rather than four.

**The binding constraint is memory under concurrency, not latency.** 24 ms is
far inside any interactive budget; latency is not what stops us going higher.
Concurrent logins are: 19 MiB supports ~100 of them in 1.9 GiB, where 64 MiB
needs 6.4 GiB.

**Which is why the default is the floor rather than the measured optimum.**
The two failure modes are not symmetric. Too little memory degrades
continuously — cracking gets cheaper in proportion. Too much fails
discontinuously: the process cannot allocate during a login burst and the
service is _down_, for everyone, including users whose passwords were never
at risk. A library default has to survive the worst deployment it lands in —
a 512 MiB container, a serverless function with a 128 MiB floor.

**So raise it deliberately, on your own hardware.** If you know your memory
ceiling and your peak concurrent logins, `m=65536 t=3 p=1` is a better number:

```ts
const PARAMS = { memoryCost: 65536, timeCost: 3, parallelism: 1 };

await hashPassword(password, PARAMS);

// and upgrade existing users as they log in
if (await verifyPassword(user.passwordHash, password, PARAMS)) {
  if (passwordNeedsRehash(user.passwordHash, PARAMS)) {
    await users.setPasswordHash(user.id, await hashPassword(password, PARAMS));
  }
}
```

Salt length (16 bytes) and digest length (32 bytes) are `argon2`'s defaults
and RFC 9106's recommendations; this package does not change them.

## Constant-time verification

Two separate axes, and the famous one is not the one that leaks.

**The digest comparison** is handled by `argon2.verify`, which ends in
`crypto.timingSafeEqual` — read in `argon2@0.45.1`'s source, not assumed —
and derives the candidate at the stored digest's own length, so the buffers
always match and `timingSafeEqual` cannot throw.

**The control flow around the derivation** is what actually leaks in
production, and this package closes it. `verifyPassword` spends a full
derivation even when the stored hash is unusable — a corrupted row, a bcrypt
leftover, a sentinel written for a locked account — because returning early
there tells an attacker which accounts exist and which are locked without a
single successful login. `verifyPasswordDecoy` does the same for the branch
where the user does not exist at all.

Both are covered by
[`password-timing.test.ts`](tests/attacks/password-timing.test.ts), which
also verifies its own gate: with the equalising work removed, the corrupted-row
branch collapses from 15 ms to 0.0 ms and the test fails.

## What this package adds over calling `argon2` directly

Four behaviors of `argon2@0.45.1`, each confirmed against the real library
and each asserted in [`tests/unit/password.test.ts`](tests/unit/password.test.ts)
so the claims cannot rot:

| `argon2` does                                                                                    | this package does                                                                          |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `verify()` **throws** on a malformed digest (`TypeError: pchstr must contain a $ as first char`) | returns `false` — one corrupted row should not 500 a login handler                         |
| `verify()` accepts an `$argon2d$` digest and returns `true`                                      | still verifies it, so migrations don't lock anyone out, but `passwordNeedsRehash` flags it |
| `needsRehash()` returns `false` for an `$argon2d$` digest whose `m`/`t`/`p` match                | returns `true` — checks the variant, so rehash-on-login actually migrates it               |
| `needsRehash()` **throws** on a malformed digest                                                 | returns `true`                                                                             |

`passwordNeedsRehash` is synchronous and takes no password, because
rehash-need is a property of the stored digest alone — so you can also run it
as an audit across a whole table.

## API

| Export                                          | What it does                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `hashPassword(password, params?)`               | argon2id digest, PHC-format, safe to store as-is                                            |
| `verifyPassword(storedHash, password, params?)` | `boolean`; never throws; equalises timing on the unusable-hash path                         |
| `verifyPasswordDecoy(password, params?)`        | always `false`, after spending a real derivation — for the no-such-user branch              |
| `passwordNeedsRehash(storedHash, params?)`      | synchronous; `true` for a non-argon2id variant, below-target costs, or an unreadable digest |
| `DEFAULT_ARGON2_PARAMS`                         | `{ memoryCost: 19456, timeCost: 2, parallelism: 1 }`, frozen                                |
| `MAX_PASSWORD_BYTES`                            | `1024`                                                                                      |
| `createJwtSigner(options)`                      | one algorithm, one key, fixed issuer/audience/TTL                                           |
| `createJwtVerifier(options)`                    | mandatory allowlist, validated against the key at construction                              |
| `MAX_CLOCK_TOLERANCE_SECONDS`                   | `300`                                                                                       |
| `JwtVerificationError`                          | extends `core`'s `UnauthorizedError`; carries a `reason` and a `code` like `JWT_EXPIRED`    |
| `AuthConfigurationError`                        | thrown at construction; `httpStatus` 500, never the client's fault                          |
| `PasswordHashError`                             | the derivation itself failed (allocation, native error) — not a wrong password              |

### Rejection reasons

`malformed`, `algorithm_not_allowed`, `untrusted_header`, `type_mismatch`,
`signature_invalid`, `expired`, `not_yet_valid`, `too_old`,
`issuer_mismatch`, `audience_mismatch`, `claims_invalid`,
`verification_failed`.

These are safe to return to the client. Distinguishing `expired` from
`signature_invalid` is not a credential oracle the way distinguishing "no
such user" from "wrong password" is — the holder of an expired token already
knows it is theirs, and needs telling to refresh rather than to
re-authenticate. Nothing in a message echoes the token or any key material.

`JwtVerificationError` extends `core`'s `UnauthorizedError`, so a generic
handler that catches `UnauthorizedError` sees it too, and
[`@firstprinciples/api-kit`](../api-kit) renders it as a 401 RFC 7807 problem
document with no extra wiring. Its `kind` stays `'UnauthorizedError'` —
correct, because that is what it is to anything switching on the taxonomy —
while `name` is its own.

That subclass is the reason `core` keeps `kind` separate from `name`. With one
property doing both jobs the built-ins are mutually distinct and, as a side
effect, impossible to extend. The first draft of this package worked around
that by extending `AppError` directly and losing `instanceof
UnauthorizedError`; `core` was fixed instead.

## Refresh-token rotation

A refresh token is a bearer credential with a long life, which makes theft of
one both valuable and, without rotation, silent. Rotation makes it noisy: each
token is good for exactly one exchange, so if two parties hold a copy, the
second one to use it presents a token that has already been rotated. That is
the detection, and it is the only signal you get.

```ts
import {
  createMemoryRefreshTokenStore,
  createRefreshTokenService,
} from '@firstprinciples/auth-utils';
import { isOk } from '@firstprinciples/core';

const refresh = createRefreshTokenService({
  store: createMemoryRefreshTokenStore(), // swap for Redis or your database
  ttlSeconds: 60 * 60 * 24 * 7, // one token's life
  absoluteTtlSeconds: 60 * 60 * 24 * 30, // the session's hard ceiling
});

// after authenticating
const issued = await refresh.issue({ subject: user.id });

// on POST /refresh
const result = await refresh.rotate(presentedToken);
if (isOk(result)) {
  const accessToken = await signer.sign({ sub: result.value.subject });
  setCookie(result.value.token);
} else {
  if (result.error.reason === 'reused') alertSecurityTeam(result.error);
  return unauthorized();
}

// on logout
await refresh.revoke(presentedToken);
```

**Replay revokes the entire family, not just the replayed token.** This is the
part that is easy to half-implement and worthless when half-implemented. When a
replay is detected the server cannot tell which of the two holders is the
legitimate client — the attacker may well be the one holding the _current_
token — so every token descended from that login dies and the user signs in
again. Killing only the replayed token would leave the thief's session intact.

**Rotation is atomic**, with no instant where both the old and new token are
valid, and none where neither is. That falls out of the data model rather than
from a distributed transaction: a whole family is one record, so invalidating
the presented token and issuing its successor are edits to the same object and
reach the store as a single write. What is left is an ordinary read-modify-write
race, handled with compare-and-set.

Two clients presenting the same token at once therefore resolve strictly: one
rotation succeeds, the loser retries, sees a rotated token, and revokes the
family. That is indistinguishable from theft from where the server stands, so
it is treated as theft. **A client that double-submits its refresh will log the
user out** — single-flight the call on the client rather than asking the server
to guess. There is deliberately no grace window: implementing one means
returning the _same_ successor to a repeated request, which means storing that
successor in plaintext, which is the property this design exists to avoid.

`reused` fires **exactly once per family**, at detection. Later replays report
`revoked`, so one incident produces one alert rather than a stream.

### Bring your own store

`RefreshTokenStore` is four methods, and only `compareAndSet` has to be clever:
it must write only if the record's revision is unchanged, atomically. Redis does
this with `WATCH`/`MULTI` or a Lua script, SQL with
`UPDATE … WHERE id = ? AND revision = ?`, DynamoDB with a conditional write.

Compare-and-set rather than a lock, deliberately: a lock needs a lease, and a
lease needs a correct answer to "what if the holder stalls past it" — the
question distributed locking has never answered cleanly. A lost compare-and-set
has no such failure mode; the loser simply retries, and on retry it is the one
that detects the reuse.

`createMemoryRefreshTokenStore()` is correct for exactly one process. Two
instances each get their own map, so reuse detection cannot see across them.

### Why SHA-256 here and argon2id for passwords

Argon2's cost exists to make _guessing_ expensive, and guessing is only a threat
when the input has little entropy — which is what a human-chosen password has. A
refresh token is 256 uniformly random bits and cannot be guessed at any cost, so
stretching it buys nothing and would put a ~24 ms derivation on every refresh.
What is needed is preimage resistance, so an attacker who reads the store cannot
work backwards to a usable token. Tokens are stored as a SHA-256 digest and the
plaintext is never persisted.

## Login-attempt rate limiting

```ts
const limiter = createLoginRateLimiter({
  store: createMemoryAttemptStore(),
  maxAttempts: 5,
  windowSeconds: 900,
});

if (!(await limiter.check(key)).allowed) return tooManyRequests();
if (await verifyPassword(hash, password)) await limiter.recordSuccess(key);
else await limiter.recordFailure(key);
```

**Choosing the key is the security decision here, not a detail.** Keying on the
username alone lets anyone lock out any account they can name. Keying on the
client IP alone punishes everyone behind a NAT together and does nothing to an
attacker with an address pool. Run two limiters: a tight one per `username|ip`
and a looser one per username, so a distributed guessing attack is still bounded.
Count against the key whether or not the account exists — a limiter that only
counts for real users is a user-enumeration oracle, the same one
`verifyPasswordDecoy` closes on the timing side.

The window doubles as the lockout, and it starts at the first failure rather
than sliding forward with each one; otherwise a steady attacker holds it open
forever. It is a fixed window, so an attacker timing failures either side of a
boundary gets up to `2 × maxAttempts` in quick succession — a real property,
accepted because the sustained bound is what stops password guessing.

**When the store fails, the limiter fails closed** — the one place this package
deliberately decides the opposite way to `cache-kit`, whose `wrap` swallows
backend errors because a cache being down must not become a new failure mode.
Here it must: a rate limiter is a control, and failing open means whoever can
knock over your Redis has bought unlimited password guesses. Pass
`onStoreError: 'allow'` if you have another throttle in front.

## License

MIT
