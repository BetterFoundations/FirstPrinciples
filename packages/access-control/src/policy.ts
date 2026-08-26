import { err, ok, ValidationError, type Result } from '@firstprinciples/core';
import type { Condition } from './conditions.js';
import { validatePolicy, type PolicyIssue } from './internal/validate.js';

/**
 * The portable rule schema: policy authoring, validation, and the
 * boundary a policy crosses to reach a browser.
 *
 * @packageDocumentation
 */

/**
 * Whether a rule grants or refuses.
 *
 * @remarks
 * There is no default. A rule whose effect must be inferred from where
 * it sits in a list is a rule nobody can audit by reading it alone.
 *
 * @public
 */
export type Effect = 'allow' | 'deny';

/**
 * One rule: an effect, what it applies to, who it applies to, and the
 * condition under which it applies at all.
 *
 * @typeParam A - The policy's declared action names.
 * @typeParam S - The policy's declared subject names.
 * @typeParam R - The policy's declared role names.
 *
 * @remarks
 * Rules are **unordered**. Their position in the array never changes a
 * decision — see {@link definePolicy} for the resolution order that
 * replaces it.
 *
 * @public
 */
export interface Rule<
  A extends string = string,
  S extends string = string,
  R extends string = string,
> {
  /**
   * Optional stable name, reported by `explain()` as the rule that
   * decided. Must be unique within the policy.
   */
  readonly id?: string;
  /** Optional prose for humans reading the policy. Never evaluated. */
  readonly description?: string;
  /** Grant or refuse. See {@link Effect}. */
  readonly effect: Effect;
  /** Declared actions this rule covers, or `'*'` for every declared action. */
  readonly actions: readonly A[] | '*';
  /** Declared subjects this rule covers, or `'*'` for every declared subject. */
  readonly subjects: readonly S[] | '*';
  /**
   * Declared roles this rule applies to. Omit to apply it to **every**
   * caller, anonymous included.
   *
   * @remarks
   * A principal matches if it holds any one of these roles, directly or
   * by inheritance. Role names are compared exactly — nothing is
   * lower-cased.
   */
  readonly roles?: readonly R[];
  /**
   * The attribute condition. Omit for an unconditional rule.
   *
   * @remarks
   * A condition that cannot be evaluated — because the attributes it
   * names were not supplied — is `unknown`, and `unknown` is treated
   * differently by effect: an `allow` does not fire, a `deny` does.
   */
  readonly when?: Condition;
}

/**
 * A validated, normalized, deep-frozen policy.
 *
 * @typeParam A - The declared action names, as a literal union.
 * @typeParam S - The declared subject names, as a literal union.
 *
 * @remarks
 * This is plain JSON data — `JSON.stringify` it, send it to a browser,
 * and {@link parsePolicy} it back. The only thing that does not survive
 * the trip is the internal brand that marks it as validated, and that is
 * the point: a policy that has crossed a boundary is untrusted input
 * again and must be re-validated before use.
 *
 * @public
 */
export interface Policy<A extends string = string, S extends string = string> {
  /** Every action this policy knows about. Anything else is denied. */
  readonly actions: readonly A[];
  /** Every subject this policy knows about. Anything else is denied. */
  readonly subjects: readonly S[];
  /** Role graph, normalized to a map from each role to the roles it inherits. */
  readonly roles: Readonly<Record<string, readonly string[]>>;
  /** The rules, in authoring order — which never affects a decision. */
  readonly rules: readonly Rule<A, S>[];
}

/**
 * The input to {@link definePolicy}.
 *
 * @typeParam A - Inferred from `actions`.
 * @typeParam S - Inferred from `subjects`.
 * @typeParam R - Inferred from `roles`.
 *
 * @remarks
 * Every reference from a rule back to a declared name is wrapped in
 * `NoInfer`, so a typo inside a rule is a **compile error** rather than
 * a silent widening of the declared universe. Without it,
 * `subjects: ['post']` plus a rule saying `subjects: ['pots']` would
 * infer `S` as `'post' | 'pots'` and the typo would typecheck — and then
 * `can('read', 'pots')` would typecheck too.
 *
 * @public
 */
export interface PolicyDefinition<A extends string, S extends string, R extends string = never> {
  /** Every action the system has. Declaring them is what makes an undeclared one deniable. */
  readonly actions: readonly A[];
  /** Every kind of thing an action can be taken on. */
  readonly subjects: readonly S[];
  /**
   * Roles, either as a flat list or as a map from each role to the roles
   * it inherits.
   *
   * @example
   * ```ts
   * roles: ['admin', 'author']                      // no inheritance
   * roles: { admin: ['author'], author: [] }        // admin is also an author
   * ```
   *
   * @remarks
   * The map form is typed as a mapped type over `R` rather than as
   * `Record<R, readonly R[]>` so that inference is driven by its
   * **keys**. With `Record`, the inherited names on the right-hand side
   * would be inferred into `R` first and the declaring keys would then
   * be checked against them — so `\{ admin: ['editor'], editor: [] \}`
   * would reject `admin`, the one name that is certainly declared.
   */
  readonly roles?: readonly R[] | { readonly [K in R]: readonly NoInfer<R>[] };
  /** The rules. Order is irrelevant. */
  readonly rules: readonly Rule<NoInfer<A>, NoInfer<S>, NoInfer<R>>[];
}

/**
 * Marks a policy as having been through validation.
 *
 * Taken from the global symbol registry for the same reason `core`'s
 * `AppError` brand is: two copies of this package in one process (the
 * ESM build and the CJS build) define two distinct module scopes, and a
 * `Symbol.for` key is the same symbol in both.
 */
const POLICY_BRAND = Symbol.for('@firstprinciples/access-control/Policy');

/** Recursively freezes a normalized policy so it cannot drift after validation. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  for (const key of Object.getOwnPropertyNames(value)) {
    // Own-property walk over a structure this module just built.
    // eslint-disable-next-line security/detect-object-injection
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

function brandPolicy<A extends string, S extends string>(policy: Policy): Policy<A, S> {
  Object.defineProperty(policy, POLICY_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return deepFreeze(policy) as Policy<A, S>;
}

/**
 * Whether a value is a policy this package validated.
 *
 * @param value - Anything.
 *
 * @remarks
 * The brand is a non-enumerable own property, so it is invisible to
 * `JSON.stringify` and to `toEqual`. A policy that has been through the
 * wire is therefore *not* a policy by this test, which is exactly the
 * intent — run {@link parsePolicy} on it first.
 *
 * @public
 */
export function isPolicy(value: unknown): value is Policy {
  if (typeof value !== 'object' || value === null) return false;
  // Own-property only. `brandPolicy` defines the brand directly on the
  // policy, so an inherited one is never this package's doing — it is a
  // polluted `Object.prototype`, and honouring it would let any object
  // at all pass for a validated policy.
  if (!Object.prototype.hasOwnProperty.call(value, POLICY_BRAND)) return false;
  // A read of a module-private symbol key, not a caller-supplied one —
  // there is no injection sink here.
  // eslint-disable-next-line security/detect-object-injection
  return (value as Record<symbol, unknown>)[POLICY_BRAND] === true;
}

function toValidationError(issues: readonly PolicyIssue[]): ValidationError {
  const summary = issues
    .slice(0, 3)
    .map((issue) => (issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`))
    .join(' ');
  const more = issues.length > 3 ? ` (+${issues.length - 3} more)` : '';
  return new ValidationError(`Invalid policy. ${summary}${more}`, {
    code: 'INVALID_POLICY',
    details: { issues },
  });
}

/**
 * Validates and freezes a policy you are authoring.
 *
 * @param definition - See {@link PolicyDefinition}.
 * @returns A {@link Policy} whose action and subject unions are inferred
 * from what you declared, so `can()` autocompletes them and rejects
 * anything else at compile time.
 *
 * @throws A `ValidationError` from `@firstprinciples/core`, carrying
 * **every** problem found in `details.issues` rather than only the
 * first.
 *
 * @remarks
 * Authoring a policy is startup configuration, so this throws where
 * {@link parsePolicy} returns a `Result`: a policy the developer wrote
 * wrong should fail at startup, not on whichever request first reaches
 * the bad rule. That is the same split `auth-utils` draws between
 * constructing a verifier and verifying a token.
 *
 * What it rejects is chosen to close the two silent failure modes a
 * permission system has. A rule naming an undeclared action, subject or
 * role is rejected because such a rule never matches — harmless-looking
 * when it was an `allow`, a hole when it was a `deny`. And declaring the
 * action and subject universes up front is what lets an *undeclared*
 * action be denied at the call site instead of falling through to a
 * wildcard rule.
 *
 * The returned policy is a deep copy: mutating the object you passed in
 * afterwards cannot change it. It is also deep-frozen, so nothing can
 * mutate it later either.
 *
 * ### Resolution order
 *
 * Decisions do not depend on the order of `rules`. For each check:
 *
 * 1. An action or subject the policy does not declare is **denied**.
 * 2. Rules matching the action, the subject, and the caller's roles are
 *    gathered.
 * 3. If any matching `deny` evaluates `true` — **denied**.
 * 4. If any matching `deny` evaluates `unknown` — **denied**.
 * 5. If any matching `allow` evaluates `true` — **allowed**.
 * 6. Otherwise — **denied**.
 *
 * An `allow` never counts on `unknown`; a `deny` always does.
 *
 * @example
 * ```ts
 * const policy = definePolicy({
 *   actions: ['read', 'update', 'delete'],
 *   subjects: ['post'],
 *   roles: { admin: ['author'], author: [] },
 *   rules: [
 *     { effect: 'allow', actions: '*', subjects: '*', roles: ['admin'] },
 *     { effect: 'allow', actions: ['read'], subjects: ['post'] },
 *     {
 *       id: 'author-edits-own',
 *       effect: 'allow',
 *       actions: ['update', 'delete'],
 *       subjects: ['post'],
 *       roles: ['author'],
 *       when: owns('authorId'),
 *     },
 *     {
 *       id: 'locked-posts-are-frozen',
 *       effect: 'deny',
 *       actions: ['update', 'delete'],
 *       subjects: ['post'],
 *       when: { path: 'resource.locked', op: 'eq', value: true },
 *     },
 *   ],
 * });
 * ```
 *
 * @public
 */
export function definePolicy<
  const A extends string,
  const S extends string,
  const R extends string = never,
>(definition: PolicyDefinition<A, S, R>): Policy<A, S> {
  const outcome = validatePolicy(definition);
  if (outcome.policy === undefined) throw toValidationError(outcome.issues);
  return brandPolicy<A, S>(outcome.policy);
}

/**
 * Validates a policy that arrived from somewhere you do not control —
 * a `fetch`, a config file, `localStorage`.
 *
 * @param input - Anything. Typically the result of `JSON.parse`.
 * @returns `ok(policy)` or `err(validationError)`, whose
 * `details.issues` lists every problem.
 *
 * @remarks
 * This returns a `Result` rather than throwing because untrusted input
 * failing validation is an expected outcome, not an exceptional one —
 * the same distinction `core` draws with its branded primitives, and the
 * reason a browser that is handed a malformed policy should render a
 * degraded UI rather than white-screen.
 *
 * The action and subject unions are lost: a value parsed at runtime
 * cannot carry literal types. Casting the result to `Policy<A, S>` is
 * safe when you know which policy you asked for — an action the parsed
 * policy does not actually declare is denied at the call site regardless
 * of what the cast claims.
 *
 * @example
 * ```ts
 * const parsed = parsePolicy(await (await fetch('/api/policy')).json());
 * if (isErr(parsed)) return renderWithoutPermissions();
 * const ac = createAccessControl(parsed.value);
 * ```
 *
 * @public
 */
export function parsePolicy(input: unknown): Result<Policy, ValidationError> {
  const outcome = validatePolicy(input);
  if (outcome.policy === undefined) return err(toValidationError(outcome.issues));
  return ok(brandPolicy(outcome.policy));
}
