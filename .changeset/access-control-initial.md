---
'@firstprinciples/access-control': minor
---

Initial release: an isomorphic RBAC/ABAC permission engine.

One policy, authored as plain JSON, compiles into the same engine in a browser
and on a server. `definePolicy` declares the action and subject universes and
infers them as literal types, so a typo at a call site is a compile error;
`parsePolicy` validates the same schema when it arrives over the wire.

Three properties are enforced structurally rather than by convention:

- **Deny by default, including for undeclared actions and subjects.** An action
  the policy does not declare is denied before any rule — wildcards included —
  is consulted.
- **Unanswerable questions fail closed.** Conditions evaluate in three-valued
  logic: an `allow` fires only on a definite `true`, a `deny` fires on `unknown`
  too. An ownership rule checked without the resource in hand denies, and two
  absent ids never compare equal.
- **Rule order never decides anything.** Denies beat allows, allows beat
  silence, silence denies.

Ships `createExpressGuard`, `createFastifyGuard` and `createHonoGuard`, plus a
React `<Can>` component and `usePermission()`/`usePermissions()` hooks. Denials
throw `PermissionDeniedError`, a `ForbiddenError` from `@firstprinciples/core`,
whose serialized form carries only the action and subject the caller already
named — the reason and the deciding rule stay server-side.
