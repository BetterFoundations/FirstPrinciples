import type { Condition, JsonPrimitive } from '../conditions.js';
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
 */

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
  if ('all' in condition) {
    return all(condition.all.map((operand) => evaluateCondition(operand, environment)));
  }
  if ('any' in condition) {
    return any(condition.any.map((operand) => evaluateCondition(operand, environment)));
  }
  if ('not' in condition) {
    return negate(evaluateCondition(condition.not, environment));
  }

  const left = resolvePath(environment, condition.path);

  if (condition.op === 'exists' || condition.op === 'notExists') {
    // The only operators that can answer definitively about a missing
    // attribute — and only when its root was supplied. `unresolved`
    // (root absent, or a read threw) stays `unknown` for both.
    if (left.kind === 'unresolved') return 'unknown';
    const present = left.kind === 'value';
    return fromBoolean(condition.op === 'exists' ? present : !present);
  }

  if ('ref' in condition) {
    return applyBinary(condition.op, left, resolvePath(environment, condition.ref));
  }
  if ('value' in condition) {
    return applyBinary(condition.op, left, literal(condition.value));
  }
  // Unreachable for a validated policy — a binary operator with neither
  // `value` nor `ref` is rejected by `parsePolicy`. Reachable only for a
  // hand-forged condition object, and `unknown` denies either way.
  /* c8 ignore next */
  return 'unknown';
}
