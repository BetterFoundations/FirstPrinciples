/**
 * Attribute-path resolution.
 *
 * Every condition operand is a dotted path into one of three roots —
 * `principal`, `resource`, `env`. Resolution is the only place attacker-
 * shaped data is walked, so it does three things carefully: it never
 * leaves own properties, it never throws, and it distinguishes *absent*
 * from *unresolved*.
 */

/** The three roots a condition path may address. */
export const PATH_ROOTS = ['principal', 'resource', 'env'] as const;

/** One of `principal`, `resource`, `env`. */
export type PathRoot = (typeof PATH_ROOTS)[number];

/**
 * Path segments that are never walked, rejected at policy-definition
 * time as well as here.
 *
 * @remarks
 * Own-property-only walking (see {@link resolvePath}) already makes
 * prototype climbing impossible, so this list is the second of two
 * independent defences rather than the only one. It is kept because a
 * policy containing `principal.__proto__.isAdmin` is a bug worth
 * failing loudly on, not silently denying.
 */
export const FORBIDDEN_SEGMENTS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/**
 * The outcome of resolving one path.
 *
 * The `absent` / `unresolved` split matters for exactly one pair of
 * operators — `exists` and `notExists`:
 *
 * - `absent` is a **fact**: the root was supplied and does not carry
 *   this attribute. `notExists` may answer `true`.
 * - `unresolved` is an **absence of facts**: the root was never supplied,
 *   or reading it threw. Every operator answers `unknown`.
 *
 * Comparison operators treat the two identically (both yield `unknown`).
 */
export type Resolved =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unresolved' };

const ABSENT: Resolved = { kind: 'absent' };
const UNRESOLVED: Resolved = { kind: 'unresolved' };

/**
 * The attribute roots a single `can()` call resolves paths against.
 *
 * A root of `undefined` means "not supplied" — every path under it
 * resolves to `unresolved`, never to `absent`.
 */
export interface AttributeEnvironment {
  readonly principal: unknown;
  readonly resource: unknown;
  readonly env: unknown;
}

/**
 * Normalizes a read value.
 *
 * `null` and `undefined` are folded into `absent` on purpose: the single
 * worst bug in ownership checks is `principal.id === resource.ownerId`
 * evaluating `undefined === undefined` to `true`, handing an anonymous
 * caller ownership of an unowned row. Treating both as "no value" makes
 * that comparison `unknown`, and `unknown` never grants.
 *
 * Non-finite numbers (`NaN`, `±Infinity`) are folded in for a second
 * reason: they do not survive `JSON.stringify`, so a policy that
 * branched on one would decide differently on the client (where the
 * value arrived over the wire as `null`) than on the server. A value
 * that cannot be transported cannot be reasoned about isomorphically.
 */
function normalize(value: unknown): Resolved {
  if (value === null || value === undefined) return ABSENT;
  if (typeof value === 'number' && !Number.isFinite(value)) return ABSENT;
  return { kind: 'value', value };
}

/**
 * Reads one own property, treating a throwing getter as `unresolved`
 * rather than `absent`.
 *
 * @remarks
 * The distinction is load-bearing. A hostile object whose getter throws
 * would, if reported as `absent`, make `\{ op: 'exists' \}` answer a
 * definite `false` — and a `deny … when resource.classified exists`
 * would then not fire. Reporting `unresolved` makes it `unknown`, and
 * an `unknown` deny still denies.
 */
function readOwn(target: unknown, key: string): Resolved {
  if (target === null || typeof target !== 'object') return ABSENT;
  try {
    if (!Object.prototype.hasOwnProperty.call(target, key)) return ABSENT;
    // A read of an own property whose key came from a policy already
    // validated against FORBIDDEN_SEGMENTS, on an object reached only
    // through other own properties. There is no write and no prototype
    // reachable from here.
    // eslint-disable-next-line security/detect-object-injection
    return normalize((target as Record<string, unknown>)[key]);
  } catch {
    return UNRESOLVED;
  }
}

/**
 * Resolves `root.a.b` against `environment`.
 *
 * @param environment - The three roots for this decision.
 * @param path - A dotted path whose first segment is a {@link PathRoot}.
 * Assumed already validated by `definePolicy`/`parsePolicy`; an
 * unrecognized root still resolves to `unresolved` rather than throwing,
 * because a policy can also arrive from the wire.
 *
 * @returns `unresolved` when the root was not supplied (or is not an
 * object, or a read threw), `absent` when the root was supplied but the
 * attribute is missing/`null`/non-finite, otherwise the value.
 *
 * @remarks
 * Walking stops at own properties only. Nothing on a prototype — not
 * `constructor`, not a class's accessor, not `toString` — is reachable,
 * which is why a polluted `Object.prototype` cannot change a decision.
 * The cost is that class instances with prototype getters resolve to
 * `absent`; policies are evaluated against plain data by design.
 */
export function resolvePath(environment: AttributeEnvironment, path: string): Resolved {
  const segments = path.split('.');
  const [root, ...rest] = segments;
  if (root === undefined || rest.length === 0) return UNRESOLVED;

  let current: unknown;
  if (root === 'principal') current = environment.principal;
  else if (root === 'resource') current = environment.resource;
  else if (root === 'env') current = environment.env;
  else return UNRESOLVED;

  // A root that was never supplied — or supplied as `null`, or as
  // something that is not an object at all — is the "missing or null
  // context" case, and it must be `unresolved`, never `absent`.
  if (current === null || current === undefined || typeof current !== 'object') return UNRESOLVED;

  let resolved: Resolved = { kind: 'value', value: current };
  for (const segment of rest) {
    if (resolved.kind !== 'value') return resolved;
    resolved = readOwn(resolved.value, segment);
  }
  return resolved;
}
