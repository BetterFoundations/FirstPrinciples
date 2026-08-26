/**
 * Three-valued (Kleene K3) logic.
 *
 * A condition is not a boolean. It is `true`, `false`, or `unknown` —
 * where `unknown` means "this policy asks about an attribute nobody
 * supplied". Collapsing `unknown` into `false` early is exactly how
 * permission engines fail open: `not: { resource.locked eq true }` would
 * become `true` for a caller who never passed the resource.
 *
 * Keeping the third value all the way to the decision lets the engine
 * treat it asymmetrically — an `allow` needs `true`, a `deny` settles for
 * `unknown` — which is the whole fail-closed property.
 */

/** `true`, `false`, or "not enough information to say". */
export type Ternary = 'true' | 'false' | 'unknown';

/** Lifts a definite boolean into {@link Ternary}. */
export function fromBoolean(value: boolean): Ternary {
  return value ? 'true' : 'false';
}

/**
 * Kleene conjunction: `false` if any operand is `false` (a known
 * counter-example settles it, whatever else is unknown), otherwise
 * `unknown` if any operand is `unknown`, otherwise `true`.
 *
 * @param operands - Must be non-empty; an empty `all` is rejected at
 * policy-definition time rather than being silently vacuously true.
 */
export function all(operands: readonly Ternary[]): Ternary {
  let sawUnknown = false;
  for (const operand of operands) {
    if (operand === 'false') return 'false';
    if (operand === 'unknown') sawUnknown = true;
  }
  return sawUnknown ? 'unknown' : 'true';
}

/**
 * Kleene disjunction: `true` if any operand is `true`, otherwise
 * `unknown` if any operand is `unknown`, otherwise `false`.
 *
 * @param operands - Must be non-empty; see {@link all}.
 */
export function any(operands: readonly Ternary[]): Ternary {
  let sawUnknown = false;
  for (const operand of operands) {
    if (operand === 'true') return 'true';
    if (operand === 'unknown') sawUnknown = true;
  }
  return sawUnknown ? 'unknown' : 'false';
}

/**
 * Kleene negation. `unknown` negates to `unknown` — **not** to `true`.
 *
 * @remarks
 * This single line is what stops `not` from being a fail-open escape
 * hatch. Under two-valued logic, a `not` wrapping
 * `resource.locked eq true`, evaluated against a caller who passed no
 * resource, would yield `true` and grant the permission.
 */
export function negate(operand: Ternary): Ternary {
  if (operand === 'true') return 'false';
  if (operand === 'false') return 'true';
  return 'unknown';
}
