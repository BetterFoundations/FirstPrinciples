import type { AllOf, AnyOf, Condition, JsonPrimitive, NotCondition } from '../conditions.js';
import { resolvePath, type AttributeEnvironment, type Resolved } from './resolve.js';
import { all, any, fromBoolean, negate, type Ternary } from './truth.js';

/**
 * Condition evaluation: `Condition` + attributes -\> {@link Ternary}.
 *
 * Two rules govern every operator here, and both exist to keep a
 * decision portable and non-coercing:
 *
 * 1. **An operand that is not a primitive makes the comparison
 *    `unknown`.** Object identity does not survive `JSON.stringify`, so
 *    a policy that compared objects would decide differently on each
 *    side of the wire.
 * 2. **No coercion.** Equality is strict; ordering is defined only
 *    between two numbers or two strings. JavaScript's own relational
 *    coercion — where `'10' > 9` — is exactly the kind of surprise a
 *    permission check cannot afford.
 *
 * A third rule governs how a condition's *own shape* is read, and it is
 * the same one `resolve.ts` applies to the data being compared: **only
 * own properties count.** A condition is a plain object literal, so it
 * inherits from `Object.prototype`, and `'all' in condition` would
 * answer `true` for every condition ever written if something in the
 * process had set `Object.prototype.all`. Reading structure with `in`
 * therefore hands an attacker who can pollute a prototype the ability to
 * rewrite every rule in the policy at once. Every structural read below
 * goes through {@link hasOwn}.
 */

/** Maximum nesting depth of `all`/`any`/`not` in one condition. */
export const MAX_CONDITION_DEPTH = 32;

/**
 * Whether `key` is an **own** property of `value`.
 *
 * @remarks
 * The only way structure is ever read in this module. See the module
 * remarks for why `in` and a bare property read are both unsafe here.
 */
function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Reads an own property, or `undefined` if it is not one. */
function readOwn(value: object, key: string): unknown {
  if (!hasOwn(value, key)) return undefined;
  // Own-property read, key from a fixed literal set in this file.
  // eslint-disable-next-line security/detect-object-injection
  return (value as Record<string, unknown>)[key];
}

/** A literal operand, lifted into the same shape a resolved path produces. */
function literal(value: unknown): Resolved {
  return { kind: 'value', value };
}

function isPrimitive(value: unknown): value is JsonPrimitive {
  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean';
}

/**
 * Ordering, defined only for two numbers or two strings.
 *
 * @returns `unknown` for any other pair, including a number against a
 * numeric string.
 */
function order(
  op: 'gt' | 'gte' | 'lt' | 'lte',
  left: JsonPrimitive,
  right: JsonPrimitive,
): Ternary {
  const comparable =
    (typeof left === 'number' && typeof right === 'number') ||
    (typeof left === 'string' && typeof right === 'string');
  if (!comparable) return 'unknown';
  switch (op) {
    case 'gt':
      return fromBoolean(left > right);
    case 'gte':
      return fromBoolean(left >= right);
    case 'lt':
      return fromBoolean(left < right);
    case 'lte':
      return fromBoolean(left <= right);
  }
}

/** Applies one binary operator to two already-resolved operands. */
function applyBinary(op: string, left: Resolved, right: Resolved): Ternary {
  // Either operand missing — because the root was never supplied, or the
  // attribute is absent, or a getter threw — is the fail-closed case.
  if (left.kind !== 'value' || right.kind !== 'value') return 'unknown';

  if (op === 'in' || op === 'nin') {
    if (!isPrimitive(left.value) || !Array.isArray(right.value)) return 'unknown';
    const found = right.value.some((member) => member === left.value);
    return fromBoolean(op === 'in' ? found : !found);
  }

  if (op === 'contains') {
    if (!Array.isArray(left.value) || !isPrimitive(right.value)) return 'unknown';
    return fromBoolean(left.value.some((member) => member === right.value));
  }

  if (!isPrimitive(left.value) || !isPrimitive(right.value)) return 'unknown';

  switch (op) {
    case 'eq':
      return fromBoolean(left.value === right.value);
    case 'ne':
      return fromBoolean(left.value !== right.value);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return order(op, left.value, right.value);
    default:
      // Unreachable for a validated policy. A policy that arrived from
      // the wire and slipped an unknown operator past `parsePolicy`
      // would land here, and `unknown` is the safe answer: it denies via
      // an `allow`, and it still denies via a `deny`.
      return 'unknown';
  }
}

/**
 * Evaluates one condition against one decision's attributes.
 *
 * @param condition - Already validated by `definePolicy`/`parsePolicy`,
 * but never trusted to be: every unrecognized shape answers `unknown`.
 * @param environment - The `principal` / `resource` / `env` roots.
 *
 * @returns `true`, `false`, or `unknown`. The caller — the engine's
 * `decide()` — is what turns those into a grant or a denial, and it
 * treats `unknown` differently for an `allow` rule than for a `deny`
 * rule. That asymmetry is where fail-closed actually lives; this
 * function only refuses to guess.
 */
export function evaluateCondition(
  condition: Condition,
  environment: AttributeEnvironment,
): Ternary {
  return evaluate(condition, environment, 1);
}

/**
 * @param depth - 1 at the top level, matching the convention
 * `validate.ts` uses, so nothing a validated policy can express is
 * turned away here. Past the limit the answer is `unknown`, which is
 * what stops a forged self-referential condition — reachable only
 * through a polluted `Object.prototype.not` — from recursing until the
 * stack overflows and the throw escapes `can()`.
 */
function evaluate(condition: Condition, environment: AttributeEnvironment, depth: number): Ternary {
  if (depth > MAX_CONDITION_DEPTH) return 'unknown';
  if (typeof condition !== 'object' || condition === null) return 'unknown';

  if (hasOwn(condition, 'all') || hasOwn(condition, 'any')) {
    const key = hasOwn(condition, 'all') ? 'all' : 'any';
    const operands = readOwn(condition, key) as AllOf['all'] | AnyOf['any'];
    // An empty list is rejected by `parsePolicy`, and both Kleene
    // identities for one — `all([])` is `true`, `any([])` is `false` —
    // are the fail-open direction: the first makes a conditional `allow`
    // unconditional, the second silences a `deny`.
    if (!Array.isArray(operands) || operands.length === 0) return 'unknown';
    const verdicts = operands.map((operand) => evaluate(operand, environment, depth + 1));
    return key === 'all' ? all(verdicts) : any(verdicts);
  }

  if (hasOwn(condition, 'not')) {
    const inner = readOwn(condition, 'not') as NotCondition['not'];
    return negate(evaluate(inner, environment, depth + 1));
  }

  const path = readOwn(condition, 'path');
  const op = readOwn(condition, 'op');
  if (typeof path !== 'string' || typeof op !== 'string') return 'unknown';

  const left = resolvePath(environment, path);

  if (op === 'exists' || op === 'notExists') {
    // The only operators that can answer definitively about a missing
    // attribute — and only when its root was supplied. `unresolved`
    // (root absent, or a read threw) stays `unknown` for both.
    if (left.kind === 'unresolved') return 'unknown';
    const present = left.kind === 'value';
    return fromBoolean(op === 'exists' ? present : !present);
  }

  if (hasOwn(condition, 'ref')) {
    const ref = readOwn(condition, 'ref');
    if (typeof ref !== 'string') return 'unknown';
    return applyBinary(op, left, resolvePath(environment, ref));
  }
  if (hasOwn(condition, 'value')) {
    return applyBinary(op, left, literal(readOwn(condition, 'value')));
  }
  // Unreachable for a validated policy — a binary operator with neither
  // `value` nor `ref` is rejected by `parsePolicy`. Reachable only for a
  // hand-forged condition object, and `unknown` denies either way.
  return 'unknown';
}
