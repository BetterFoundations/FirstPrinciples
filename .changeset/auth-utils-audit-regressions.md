---
'@firstprinciples/auth-utils': patch
---

Fix three audit findings in JWT verification and refresh-token rotation.

**JWT `sub` is now actually required.** `jose` only type-checks `sub`
when a `subject` option pins it to one value, so a token with `sub: 42`
or `sub: ""` previously verified and reached the caller typed as a
non-empty `string` while actually being `undefined`-shaped at runtime.
`createJwtVerifier` now requires `sub` and rejects it if it is absent,
empty, or not a string.

**A lost compare-and-set race could no longer swallow reuse detection.**
When `refreshToken` exhausted its retries after an attempt had already
concluded a presented token was a replay of one this family had rotated
away, that verdict is now persisted (revocation is retried on its own
budget) and reported as `reused`, instead of falling through to a
generic store error that left the compromised family live.

**`revoke()` now requires proof of possession.** The family id is
documented as safe to log, so revoking a session by id alone meant
anyone who had ever seen that id in a log line could end the user's
session. `revoke()` now passes the presented token's hash through to
`revokeById`, which checks it against `familyIssued` (matching the live
token or a rotated-away one, so idempotent retries of a logout still
work) before revoking. `revokeFamily`, the trusted admin path, is
unaffected.
