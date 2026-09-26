/**
 * `@firstprinciples/access-control` — one rule set, the same decisions
 * everywhere.
 *
 * A policy is plain JSON: declare your actions, subjects and roles, then
 * write rules over them. The same policy compiles into the same engine
 * in a browser, in a Node server, and in a test — so a button that is
 * hidden and a request that is refused are the same decision, made once.
 *
 * Three properties are non-negotiable, and each is enforced structurally
 * rather than by convention:
 *
 * - **Deny by default, including for what the policy has never heard
 *   of.** Actions and subjects are declared up front, and an undeclared
 *   one is denied before any rule — wildcard rules included — is
 *   consulted.
 * - **Unanswerable questions fail closed.** Conditions evaluate in
 *   three-valued logic. An `allow` fires only on a definite `true`; a
 *   `deny` fires on `unknown` too. So an ownership rule checked without
 *   the resource in hand denies, and two absent ids never match each
 *   other.
 * - **Order never decides anything.** Denies beat allows, allows beat
 *   silence, and silence denies. Shuffling the rule array cannot change
 *   an outcome.
 *
 * ```ts
 * const policy = definePolicy({
 *   actions: ['read', 'update'],
 *   subjects: ['post'],
 *   roles: ['author'],
 *   rules: [
 *     { effect: 'allow', actions: ['read'], subjects: ['post'] },
 *     { effect: 'allow', actions: ['update'], subjects: ['post'],
 *       roles: ['author'], when: owns('authorId') },
 *   ],
 * });
 *
 * const permissions = createAccessControl(policy).for(user);
 * permissions.can('update', 'post', { resource: post });
 * ```
 *
 * Server guards live at `@firstprinciples/access-control/express`,
 * `/fastify` and `/hono`; the React `<Can>` component and
 * `usePermission()` hook live at `/react`. All four read the same
 * compiled policy this module produces.
 *
 * @packageDocumentation
 */

export { definePolicy, isPolicy, parsePolicy } from './policy.js';
export type { Effect, Policy, PolicyDefinition, Rule } from './policy.js';

export { createAccessControl } from './engine.js';
export type { AccessControl, PermissionChecker } from './engine.js';

export { owns } from './conditions.js';
export type {
  AllOf,
  AnyOf,
  AttributeComparison,
  AttributeMembership,
  AttributePresence,
  AttributeReference,
  BinaryOperator,
  ComparisonOperator,
  Condition,
  JsonPrimitive,
  MembershipOperator,
  NotCondition,
  PresenceOperator,
} from './conditions.js';

export { PermissionDeniedError } from './errors.js';

export type { Decision, DecisionReason, PermissionContext, Principal } from './decision.js';

export type { PolicyIssue } from './internal/validate.js';
