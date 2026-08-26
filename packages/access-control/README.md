# @firstprinciples/access-control

[![npm](https://img.shields.io/npm/v/@firstprinciples/access-control.svg)](https://www.npmjs.com/package/@firstprinciples/access-control)
[![CI](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml/badge.svg)](https://github.com/BetterFoundations/FirstPrinciples/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@firstprinciples/access-control.svg)](../../LICENSE)

An isomorphic RBAC/ABAC engine: write your rules once as plain JSON, and get
the same decision in the browser, on the server, and in a test. Deny by
default — including for actions nobody declared. Ownership rules that fail
closed when the resource is not in hand. Rule order that cannot change an
outcome. ~5.2 kB for the engine, ~1.3 kB for a server guard, 393 B for the
React bindings.

A runnable version of every recipe below lives in
[`examples/access-control`](../../examples/access-control) —
`pnpm --filter examples-access-control start`.

## Install

```sh
pnpm add @firstprinciples/access-control
```

Express, Fastify, Hono and React are **optional** peer dependencies. Installing
this package pulls in none of them; only the subpath you import needs its
framework present.

## Quick start

```ts
import { createAccessControl, definePolicy, owns } from '@firstprinciples/access-control';

const policy = definePolicy({
  // The universe. Anything outside it is denied, wildcards included.
  actions: ['read', 'update', 'delete', 'publish'],
  subjects: ['post'],
  roles: { admin: ['author'], author: [] },

  rules: [
    { id: 'admins-do-anything', effect: 'allow', actions: '*', subjects: '*', roles: ['admin'] },
    { id: 'posts-are-public', effect: 'allow', actions: ['read'], subjects: ['post'] },
    {
      id: 'authors-edit-their-own',
      effect: 'allow',
      actions: ['update', 'delete'],
      subjects: ['post'],
      roles: ['author'],
      when: owns('authorId'),
    },
    {
      id: 'locked-posts-are-frozen',
      effect: 'deny',
      actions: ['update', 'delete'],
      subjects: ['post'],
      when: { path: 'resource.locked', op: 'eq', value: true },
    },
  ],
});

const permissions = createAccessControl(policy).for(currentUser);

permissions.can('read', 'post'); // public: true
permissions.can('update', 'post', { resource: post }); // owner and unlocked: true
permissions.can('update', 'post'); // no post in hand: false
permissions.assertCan('delete', 'post', { resource: post }); // throws PermissionDeniedError

// `update` is a declared action, so this is a compile error, not a typo
// that silently denies at 3am:
permissions.can('updaet', 'post');
//              ~~~~~~~~~ Argument of type '"updaet"' is not assignable…
```

## Why this package exists

Permission bugs are rarely dramatic. They are a `deny` rule that stopped
matching when someone renamed a role, an ownership check where `undefined ===
undefined` came out `true`, or a UI that shows a button the API will refuse —
because the button and the endpoint are two hand-written copies of the same
rule that drifted apart. This package makes those three specific things hard:
the rule set is one artifact both sides load, the engine refuses to guess when
it is missing an attribute, and a name the policy does not declare is denied
rather than assumed.

## How a decision is made

**Rules are a set, not a list.** Their order in the array never changes an
outcome — checked here against all 720 permutations of a six-rule policy and
200 shuffles of a twelve-rule one.

For every `can()` call, in this order:

| Step | Condition                                       | Result                        |
| ---- | ----------------------------------------------- | ----------------------------- |
| 1    | The action is not declared in the policy        | **deny** (`unknown_action`)   |
| 2    | The subject is not declared in the policy       | **deny** (`unknown_subject`)  |
| 3    | A matching `deny` rule's condition is `true`    | **deny** (`explicit_deny`)    |
| 4    | A matching `deny` rule's condition is `unknown` | **deny** (`unresolved_deny`)  |
| 5    | A matching `allow` rule's condition is `true`   | **allow** (`allowed`)         |
| 6    | Nothing else                                    | **deny** (`no_matching_rule`) |

A rule _matches_ when its `actions` covers the action (or is `'*'`), its
`subjects` covers the subject (or is `'*'`), and either it names no roles or
the caller holds one of the roles it names — directly or by inheritance.

Two consequences are worth stating plainly:

- **An explicit `deny` outranks everything, wildcards included.** There is no
  ordering escape hatch and no priority field. If you need "everyone except
  admins is blocked", narrow the `deny` with `roles` rather than trying to
  out-rank it.
- **Denies are inherited.** If `admin` inherits `author` and a rule denies
  `author`, admins are denied too — because under inheritance an admin _is_ an
  author. That is usually what you want; when it is not, target the deny more
  narrowly.

### Conditions have three values, not two

A condition is `true`, `false`, or **`unknown`** — where `unknown` means "this
rule asks about an attribute nobody supplied". Steps 4 and 5 above treat that
third value asymmetrically, and that asymmetry _is_ the fail-closed property:

> An `allow` fires only on `true`. A `deny` fires on `unknown` too.

So a check made without the resource in hand denies, and a `deny` you cannot
rule out still applies. Both are conservative in the direction that matters.

`unknown` propagates the way three-valued logic requires: `not unknown` stays
`unknown`, so `not` cannot be used to turn a missing attribute into a grant.
`all` still answers `false` if any operand is definitely `false`; `any` still
answers `true` if any operand is definitely `true`.

### What makes a condition `unknown`

| Situation                                                                 | Result                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| The root (`principal`, `resource`, `env`) was not supplied, or was `null` | `unknown`                                                          |
| The attribute is missing, `null`, `undefined`, `NaN` or `±Infinity`       | `unknown` for comparisons; `false`/`true` for `exists`/`notExists` |
| A getter on the resource threw                                            | `unknown`, including for `exists`                                  |
| Either operand is not a string, number or boolean                         | `unknown`                                                          |
| `gt`/`gte`/`lt`/`lte` between a number and a string                       | `unknown` — never JavaScript's `'10' > 9`                          |

Note that `null` and `undefined` are treated as _no value_, never as values
that can match each other. This is what stops the classic ownership bug:

```ts
// resource.authorId is null; the caller is anonymous.
// `undefined === undefined` would be true. Here it is `unknown`, so it denies.
{ path: 'resource.authorId', op: 'eq', ref: 'principal.id' }
```

Attribute paths are walked over **own properties only**, so a polluted
`Object.prototype` cannot manufacture an owner, and a class instance's
prototype getters are invisible — pass plain data.

## API reference

| Export                                                               | What it does                                                                                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `definePolicy(definition)`                                           | Validates, normalizes, deep-freezes and returns a `Policy`. Infers the action and subject literal unions. **Throws** a `ValidationError` listing every problem. |
| `parsePolicy(input)`                                                 | The same validation for untrusted input. Returns `Result<Policy, ValidationError>` instead of throwing.                                                         |
| `isPolicy(value)`                                                    | Whether a value carries this package's validation brand.                                                                                                        |
| `createAccessControl(policy)`                                        | Compiles a policy into an `AccessControl`. Throws if the policy was not validated.                                                                              |
| `ac.for(principal)`                                                  | Binds a caller (`null` for anonymous) and returns a `PermissionChecker`.                                                                                        |
| `permissions.can(action, subject, context?)`                         | `boolean`. Never throws.                                                                                                                                        |
| `permissions.assertCan(action, subject, context?)`                   | Throws `PermissionDeniedError` when denied.                                                                                                                     |
| `permissions.explain(action, subject, context?)`                     | The full `Decision` — `allowed`, `reason`, `ruleId`, `unknownRoles`. For logs.                                                                                  |
| `permissions.roles`                                                  | The caller's declared roles, inheritance expanded.                                                                                                              |
| `owns(resourceField?, principalField?)`                              | The ownership condition, spelled so you cannot spell it wrong. Defaults to `resource.ownerId` vs `principal.id`.                                                |
| `PermissionDeniedError`                                              | A `ForbiddenError` from `@firstprinciples/core`. `code: 'PERMISSION_DENIED'`, status 403.                                                                       |
| `createExpressGuard(ac, options)`                                    | From `/express`. Returns `requirePermission(action, subject, requirement?)`.                                                                                    |
| `createFastifyGuard(ac, options)` / `registerAccessControl(fastify)` | From `/fastify`.                                                                                                                                                |
| `createHonoGuard(ac, options)`                                       | From `/hono`.                                                                                                                                                   |
| `AccessControlProvider`, `Can`, `usePermission`, `usePermissions`    | From `/react`.                                                                                                                                                  |

### Condition operators

| Operator                 | Right-hand side                  | Notes                                                                  |
| ------------------------ | -------------------------------- | ---------------------------------------------------------------------- |
| `eq`, `ne`               | `value` or `ref`                 | Strict. No coercion.                                                   |
| `gt`, `gte`, `lt`, `lte` | `value` or `ref`                 | Two numbers or two strings only.                                       |
| `in`, `nin`              | non-empty array, or `ref` to one | Left operand must be a primitive.                                      |
| `contains`               | `value` or `ref`                 | Left operand must be an array.                                         |
| `exists`, `notExists`    | —                                | The only operators that answer definitively about a missing attribute. |
| `all`, `any`, `not`      | nested conditions                | Kleene three-valued logic.                                             |

Every condition is JSON. There are no predicate functions, on purpose: a
closure cannot cross the wire, and a rule set that cannot cross the wire cannot
be the same rule set on both sides of it.

## Recipes

### Guarding a route

The same shape on all three frameworks; only the plumbing differs. Each guard
leaves what it loaded at `res.locals.permission` / `request.permission` /
`c.get('permission')`, so the handler need not fetch the record twice.

```ts
import { createExpressGuard, type PermissionGrant } from '@firstprinciples/access-control/express';

const requirePermission = createExpressGuard(ac, {
  getPrincipal: (req) => req.user ?? null,
  onDeny: ({ decision }) =>
    logger.warn({ reason: decision.reason, ruleId: decision.ruleId }, 'denied'),
});

app.delete(
  '/posts/:id',
  requirePermission('delete', 'post', {
    getResource: (req) => posts.findById(req.params.id),
    getEnv: () => ({ maintenance: flags.maintenance }),
  }),
  (_req, res) => {
    const { resource } = res.locals.permission as PermissionGrant;
    res.json(posts.remove(resource));
  },
);

app.use(apiKitErrorHandler()); // @firstprinciples/api-kit, or your own
```

A `getResource` that returns `null` — the row does not exist — produces a
**403, not a 404**, deliberately: answering "no such record" to someone who was
not allowed to look tells them something they had not earned. A `getPrincipal`
or `getResource` that _throws_ fails the request through your error handler; it
is never converted into an allow, and never quietly into a 403 either, because
an authentication lookup that broke is not the same event as a caller who was
refused.

### The same rules in React

```tsx
import {
  AccessControlProvider,
  Can,
  usePermission,
} from '@firstprinciples/access-control/react';

<AccessControlProvider accessControl={ac} principal={session.user}>
  <App />
</AccessControlProvider>;

// Hide it…
<Can action="delete" subject="post" resource={post}>
  <DeleteButton />
</Can>

// …or disable it, which is usually kinder.
<Can action="publish" subject="post" resource={post}>
  {(allowed) => <button disabled={!allowed}>Publish</button>}
</Can>

// Or ask directly.
const canEdit = usePermission('update', 'post', { resource: post });
```

> **A client-side check is a UX affordance, never a security control.** It
> decides whether to render a button. It cannot decide whether the request
> behind the button is permitted, because the policy, the principal and the
> engine are all under the caller's control. Guard the route on the server too,
> with the same policy. The value of sharing the rules is that the button and
> the endpoint _agree_ — not that one can stand in for the other.
>
> Shipping a policy to a browser also discloses it. If a rule's mere existence
> is sensitive, do not send that rule.

### Shipping the policy to the client

```ts
// server
app.get('/api/policy', (_req, res) => res.json(policy)); // it is just JSON

// client
import { isErr, parsePolicy, createAccessControl } from '@firstprinciples/access-control';

const parsed = parsePolicy(await (await fetch('/api/policy')).json());
if (isErr(parsed)) return renderWithoutPermissions();
const ac = createAccessControl(parsed.value);
```

`createAccessControl` refuses a policy that has not been validated, and the
validation brand is deliberately non-enumerable so it does **not** survive
`JSON.stringify`. A policy that crossed a boundary is untrusted input again and
has to go back through `parsePolicy` — which is the behaviour you want, not an
inconvenience to route around.

### Attribute rules beyond ownership

```ts
rules: [
  // Same tenant only.
  {
    effect: 'allow',
    actions: ['read'],
    subjects: ['invoice'],
    when: { path: 'resource.tenantId', op: 'eq', ref: 'principal.tenantId' },
  },

  // Named collaborators.
  {
    effect: 'allow',
    actions: ['update'],
    subjects: ['doc'],
    when: { path: 'principal.id', op: 'in', ref: 'resource.editorIds' },
  },

  // Soft-deleted records are read-only, for everyone.
  {
    effect: 'deny',
    actions: ['update', 'delete'],
    subjects: ['doc'],
    when: { path: 'resource.deletedAt', op: 'exists' },
  },

  // Verified accounts, outside a freeze window, on an unarchived record.
  {
    effect: 'allow',
    actions: ['publish'],
    subjects: ['post'],
    roles: ['editor'],
    when: {
      all: [
        { path: 'principal.emailVerified', op: 'eq', value: true },
        { path: 'env.freezeWindow', op: 'eq', value: false },
        { path: 'resource.archivedAt', op: 'notExists' },
      ],
    },
  },
];
```

### Debugging a denial

```ts
const decision = permissions.explain('update', 'post', { resource: post });
// { allowed: false, reason: 'unresolved_deny', action: 'update',
//   subject: 'post', ruleId: 'locked-posts-are-frozen' }
```

`unresolved_deny` almost always means the same thing: a rule asked about an
attribute you did not pass. Pass the resource. `explain()` also reports
`unknownRoles` when the caller claims a role the policy never declared —
usually `'Admin'` against a declared `'admin'`, a drift whose only other
symptom is a rule that quietly stops matching anyone.

None of that reaches the client. `PermissionDeniedError.toJSON()` carries only
the action and subject the caller already named; the reason and the deciding
rule stay on `error.reason` and `error.ruleId`, for your logs.

### A note on authoring

Rules written inline inside `definePolicy({ ... })` infer correctly. If you
extract them into a variable, TypeScript widens `effect: 'allow'` to `string`;
annotate the array as `Rule<Action, Subject, Role>[]` or add `as const`.

## License

MIT
