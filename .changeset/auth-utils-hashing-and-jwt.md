---
'@firstprinciples/auth-utils': minor
---

Add `@firstprinciples/auth-utils` — argon2id password hashing and JWT
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
