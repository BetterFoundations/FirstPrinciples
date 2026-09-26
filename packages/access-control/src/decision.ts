/**
 * The vocabulary of one permission check: who is asking, what extra
 * attributes are in hand, and what came back.
 *
 * @remarks
 * A note on words, because two conventions collide here. In RBAC papers
 * "subject" is the *actor*. In this package — following the signature
 * this ecosystem specified, `can(action, subject, context?)` — **subject
 * is the thing being acted on** (`'post'`), and the actor is the
 * **principal**. In conditions the principal is addressed as
 * `principal.*`.
 *
 * @packageDocumentation
 */

/**
 * The caller a decision is made for.
 *
 * @remarks
 * `id` and `roles` are the two fields the engine reads structurally;
 * everything else is free-form attributes addressable from a condition
 * as `principal.<name>`. Pass only what a policy may legitimately branch
 * on — on the client this object is client-side data, and on the server
 * it is the input to a decision you will be asked to justify later.
 *
 * @public
 */
export interface Principal {
  /**
   * Stable identifier, the left-hand side of every ownership check.
   *
   * @remarks
   * Explicitly `undefined` is allowed, because `\{ id: session?.userId \}`
   * is how this object actually gets built. An absent id is not a
   * shortcut: it makes every ownership comparison `unknown`, which
   * denies.
   */
  readonly id?: string | undefined;
  /**
   * Role names, compared **exactly** against the policy's declared
   * roles. A role the policy never declared is ignored and reported on
   * {@link Decision.unknownRoles}.
   */
  readonly roles?: readonly string[] | undefined;
  /** Any further attribute, addressable as `principal.<name>`. */
  readonly [attribute: string]: unknown;
}

/**
 * The optional third argument to `can()` — the attributes that vary per
 * check rather than per caller.
 *
 * @remarks
 * Omitting it, or passing `null` for either field, is not an error and
 * is not a shortcut: every condition naming an attribute under a root
 * that was not supplied evaluates to `unknown`, which never grants and
 * always denies. Type-level questions (`can('read', 'post')`, with no
 * resource) are legitimate and answer conservatively.
 *
 * @public
 */
export interface PermissionContext {
  /**
   * The instance being acted on, addressable as `resource.<field>`.
   *
   * @remarks
   * Plain data. Only **own** properties are readable, so a class
   * instance's prototype getters resolve as absent.
   */
  readonly resource?: object | null | undefined;
  /**
   * Ambient attributes that belong to neither party — request IP,
   * current tenant, a feature flag — addressable as `env.<field>`.
   */
  readonly env?: object | null | undefined;
}

/**
 * Why a decision came out the way it did.
 *
 * - `allowed` — a matching `allow` rule's condition was `true`.
 * - `explicit_deny` — a matching `deny` rule's condition was `true`.
 * - `unresolved_deny` — a matching `deny` rule's condition was
 *   `unknown`: the attributes it names were not supplied, so the engine
 *   could not rule the denial out. Passing the resource usually turns
 *   this into a real answer.
 * - `no_matching_rule` — nothing denied, and nothing allowed either.
 *   This is deny-by-default.
 * - `unknown_action` / `unknown_subject` — the policy does not declare
 *   it. Almost always a typo, and denied before any rule is consulted.
 *
 * @public
 */
export type DecisionReason =
  | 'allowed'
  | 'explicit_deny'
  | 'unresolved_deny'
  | 'no_matching_rule'
  | 'unknown_action'
  | 'unknown_subject';

/**
 * The full result of a check, as returned by `explain()`.
 *
 * @remarks
 * `can()` returns only the boolean. This shape exists because the
 * failure mode of a permission system is silence — a button that never
 * appears, a 403 nobody can account for — and the fix for silence is a
 * reason you can log.
 *
 * None of it beyond `action` and `subject` reaches a client: see
 * `PermissionDeniedError`.
 *
 * @public
 */
export interface Decision {
  /** The answer. `can()` returns exactly this field. */
  readonly allowed: boolean;
  /** See {@link DecisionReason}. */
  readonly reason: DecisionReason;
  /** The action asked about, echoed back. */
  readonly action: string;
  /** The subject asked about, echoed back. */
  readonly subject: string;
  /**
   * The `id` of the rule that decided, when one did and it has an id.
   *
   * @remarks
   * The *decision* is order-independent. Which rule is credited for it
   * is not: when several matching rules would produce the same outcome,
   * this names the first of them in array order. Do not build logic on
   * it; log it.
   */
  readonly ruleId?: string;
  /**
   * Roles the principal claimed that the policy does not declare,
   * present only when there are any.
   *
   * @remarks
   * These were ignored. They are surfaced because the usual cause is
   * drift between whatever issues identities and the policy file
   * (`'Admin'` against a declared `'admin'`), and its symptom — a rule
   * that quietly stops matching anyone — is otherwise invisible.
   */
  readonly unknownRoles?: readonly string[];
}
