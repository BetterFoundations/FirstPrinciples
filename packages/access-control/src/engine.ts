import { ValidationError } from '@firstprinciples/core';
import type { Decision, DecisionReason, PermissionContext, Principal } from './decision.js';
import { PermissionDeniedError } from './errors.js';
import { evaluateCondition } from './internal/evaluate.js';
import type { AttributeEnvironment } from './internal/resolve.js';
import { buildRoleClosures, resolveEffectiveRoles } from './internal/roles.js';
import { isPolicy, type Policy, type Rule } from './policy.js';

/**
 * The decision core: one pure function from (policy, principal, action,
 * subject, attributes) to a {@link Decision}, plus the small amount of
 * compilation that makes it fast.
 *
 * @packageDocumentation
 */

/** Rules pre-split by effect for one subject. Wildcard-subject rules appear in every bucket. */
interface SubjectBucket {
  readonly deny: readonly Rule[];
  readonly allow: readonly Rule[];
}

/** Answers one question for one principal. */
export interface PermissionChecker<A extends string = string, S extends string = string> {
  /**
   * Whether this principal may take `action` on `subject`.
   *
   * @param action - A declared action. An undeclared one is denied.
   * @param subject - A declared subject. An undeclared one is denied.
   * @param context - Attributes for this specific check. Omitting it is
   * a legitimate type-level question, answered conservatively.
   *
   * @returns `true` only when a matching `allow` rule's condition was
   * definitely satisfied and no matching `deny` rule was satisfied or
   * unresolvable.
   *
   * @remarks
   * Never throws — not for a malformed context, not for a hostile
   * resource object, not for an unknown action. A permission check that
   * can throw is a permission check that gets wrapped in a `try/catch`
   * whose `catch` branch someone eventually writes as "allow".
   */
  can(action: A, subject: S, context?: PermissionContext): boolean;
  /**
   * {@link PermissionChecker.can}, but throws instead of returning
   * `false`.
   *
   * @throws {@link PermissionDeniedError} — a `ForbiddenError` from
   * `@firstprinciples/core`.
   */
  assertCan(action: A, subject: S, context?: PermissionContext): void;
  /**
   * {@link PermissionChecker.can}, with the reasoning attached.
   *
   * @returns The full {@link Decision}. For logging and debugging; do
   * not branch on anything but `allowed`.
   */
  explain(action: A, subject: S, context?: PermissionContext): Decision;
  /**
   * Every declared role this principal holds, inheritance expanded.
   *
   * @remarks
   * Useful for rendering ("you are an editor"), not for deciding — a
   * role check written by hand is a rule that lives outside the policy.
   */
  readonly roles: ReadonlySet<string>;
}

/** A compiled policy. Bind a principal to it with {@link AccessControl.for}. */
export interface AccessControl<A extends string = string, S extends string = string> {
  /** The policy this was compiled from, unchanged and still frozen. */
  readonly policy: Policy<A, S>;
  /**
   * Binds a principal, returning a checker for it.
   *
   * @param principal - The caller, or `null`/`undefined` for an
   * anonymous one.
   *
   * @remarks
   * Anonymous is a real, representable caller rather than an error: it
   * holds no roles, so role-targeted rules do not match it, and every
   * `principal.*` attribute is unresolved, so nothing conditioned on the
   * caller can grant. A policy with an unconditional public `allow`
   * still allows it — which is what makes public reads expressible.
   *
   * Treat the principal as immutable. Mutating it after binding will not
   * be noticed here, and will not be noticed by React's memoization
   * either.
   */
  for(principal: Principal | null | undefined): PermissionChecker<A, S>;
}

function matchesSelector(selector: readonly string[] | '*', name: string): boolean {
  return selector === '*' || selector.includes(name);
}

function matchesRoles(rule: Rule, roles: ReadonlySet<string>): boolean {
  // No `roles` on the rule means it applies to everyone, anonymous
  // included. An empty array is rejected by `definePolicy`, so this is
  // never an accidental "matches nobody".
  if (rule.roles === undefined) return true;
  return rule.roles.some((role) => roles.has(role));
}

/**
 * Compiles a validated policy into something that can answer questions.
 *
 * @param policy - A policy from {@link definePolicy} or
 * {@link parsePolicy}.
 *
 * @throws A `ValidationError` if handed anything else — including a
 * policy that has been through `JSON.stringify`/`JSON.parse`, which is
 * no longer validated. Re-validate it with `parsePolicy` first.
 *
 * @example
 * ```ts
 * const ac = createAccessControl(policy);
 * const permissions = ac.for({ id: 'u1', roles: ['author'] });
 * permissions.can('update', 'post', { resource: post });
 * ```
 *
 * @public
 */
export function createAccessControl<A extends string, S extends string>(
  policy: Policy<A, S>,
): AccessControl<A, S> {
  if (!isPolicy(policy)) {
    throw new ValidationError(
      'createAccessControl needs a policy from definePolicy() or parsePolicy(). A policy that crossed a serialization boundary has lost its validation and must be re-validated with parsePolicy().',
      { code: 'UNVALIDATED_POLICY' },
    );
  }

  const actions = new Set<string>(policy.actions);
  const subjects = new Set<string>(policy.subjects);
  const closures = buildRoleClosures(policy.roles);

  // One bucket per declared subject, with wildcard-subject rules copied
  // into each. Subjects are a closed, declared set, so this index is
  // exact rather than a fast path with a fallback.
  const index = new Map<string, SubjectBucket>();
  for (const subject of policy.subjects) {
    const applicable = policy.rules.filter((rule) => matchesSelector(rule.subjects, subject));
    index.set(subject, {
      deny: applicable.filter((rule) => rule.effect === 'deny'),
      allow: applicable.filter((rule) => rule.effect === 'allow'),
    });
  }

  return {
    policy,
    for(principal) {
      const effective = resolveEffectiveRoles(closures, principal?.roles);
      // Computed once per binding, not per check: a rule's role
      // selector cannot depend on the resource.
      const roles = effective.roles;
      const unknownRoles = effective.unknown;

      const decide = (action: string, subject: string, context?: PermissionContext): Decision => {
        const base = (
          allowed: boolean,
          reason: DecisionReason,
          ruleId?: string | undefined,
        ): Decision => ({
          allowed,
          reason,
          action,
          subject,
          ...(ruleId === undefined ? {} : { ruleId }),
          ...(unknownRoles.length === 0 ? {} : { unknownRoles }),
        });

        // Step 1. An undeclared action or subject is denied before any
        // rule is consulted, so a typo at the call site — or a wildcard
        // rule that would otherwise have swallowed it — cannot grant.
        if (!actions.has(action)) return base(false, 'unknown_action');
        if (!subjects.has(subject)) return base(false, 'unknown_subject');

        const bucket = index.get(subject);
        /* c8 ignore next -- unreachable: subjects.has() already passed, and both come from policy.subjects */
        if (bucket === undefined) return base(false, 'unknown_subject');

        const environment: AttributeEnvironment = {
          principal: principal ?? undefined,
          // `null` and `undefined` are the same thing here — a root that
          // was not supplied — and both make every path under them
          // unresolved rather than absent.
          resource: context?.resource ?? undefined,
          env: context?.env ?? undefined,
        };

        // Step 2 and 3. Denies first, and a `deny` that could not be
        // evaluated counts. Scanning past an unresolved deny to look for
        // a definite one only changes which reason is reported, never
        // the outcome.
        let unresolvedDenyId: string | undefined;
        let sawUnresolvedDeny = false;
        for (const rule of bucket.deny) {
          if (!matchesSelector(rule.actions, action)) continue;
          if (!matchesRoles(rule, roles)) continue;
          const verdict =
            rule.when === undefined ? 'true' : evaluateCondition(rule.when, environment);
          if (verdict === 'true') return base(false, 'explicit_deny', rule.id);
          if (verdict === 'unknown' && !sawUnresolvedDeny) {
            sawUnresolvedDeny = true;
            unresolvedDenyId = rule.id;
          }
        }
        if (sawUnresolvedDeny) return base(false, 'unresolved_deny', unresolvedDenyId);

        // Step 4. An `allow` needs a definite `true`. `unknown` is not
        // good enough, and that asymmetry with the loop above is the
        // entire fail-closed property.
        for (const rule of bucket.allow) {
          if (!matchesSelector(rule.actions, action)) continue;
          if (!matchesRoles(rule, roles)) continue;
          const verdict =
            rule.when === undefined ? 'true' : evaluateCondition(rule.when, environment);
          if (verdict === 'true') return base(true, 'allowed', rule.id);
        }

        // Step 5. Nothing granted it.
        return base(false, 'no_matching_rule');
      };

      return {
        roles,
        can(action, subject, context) {
          return decide(action, subject, context).allowed;
        },
        explain(action, subject, context) {
          return decide(action, subject, context);
        },
        assertCan(action, subject, context) {
          const decision = decide(action, subject, context);
          if (!decision.allowed) throw new PermissionDeniedError(decision);
        },
      };
    },
  };
}
