/**
 * The portable condition schema — the attribute half of ABAC.
 *
 * Every condition is plain JSON: no functions, no closures, no regular
 * expressions. That constraint is not aesthetic. A rule set is meant to
 * be authored once and evaluated on both sides of the wire, and a
 * predicate function cannot cross the wire. Everything here survives
 * `JSON.stringify` unchanged.
 *
 * @packageDocumentation
 */

/**
 * The only value types a policy may compare against.
 *
 * @remarks
 * `null` is deliberately absent. A policy cannot compare *to* null
 * because the engine treats null as "no value" wherever it appears in
 * the data being compared — see `internal/resolve.ts`. Use
 * `\{ op: 'notExists' \}` to ask whether an attribute is unset.
 *
 * @public
 */
export type JsonPrimitive = string | number | boolean;

/**
 * Operators that compare one attribute against a primitive.
 *
 * - `eq` / `ne` — strict equality between two primitives of the same
 *   type. No coercion, ever: `'10'` is never `10`.
 * - `gt` / `gte` / `lt` / `lte` — ordering, defined only for two numbers
 *   or two strings. A mixed pair answers `unknown` rather than falling
 *   back to JavaScript's relational coercion, where `'10' > 9` is true.
 * - `contains` — the attribute is an array containing this primitive.
 *
 * @public
 */
export type ComparisonOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';

/**
 * Operators that test membership of an attribute in a list.
 *
 * @public
 */
export type MembershipOperator = 'in' | 'nin';

/**
 * Operators that test whether an attribute has a value at all.
 *
 * @remarks
 * These are the only operators that can answer definitively when an
 * attribute is missing — and only when its *root* was supplied. See
 * {@link AttributePresence}.
 *
 * @public
 */
export type PresenceOperator = 'exists' | 'notExists';

/**
 * Every operator that takes a right-hand operand, and so may take it
 * either literally (`value`) or from a second path (`ref`).
 *
 * @public
 */
export type BinaryOperator = ComparisonOperator | MembershipOperator;

/**
 * Compare an attribute against a literal primitive.
 *
 * @example
 * ```ts
 * { path: 'resource.status', op: 'eq', value: 'published' }
 * { path: 'resource.tags', op: 'contains', value: 'internal' }
 * ```
 *
 * @public
 */
export interface AttributeComparison {
  /** Dotted path — `principal.*`, `resource.*` or `env.*`. */
  readonly path: string;
  /** See {@link ComparisonOperator}. */
  readonly op: ComparisonOperator;
  /** The literal to compare against. */
  readonly value: JsonPrimitive;
}

/**
 * Test whether an attribute is (or is not) one of a fixed list.
 *
 * @example
 * ```ts
 * { path: 'resource.status', op: 'in', value: ['draft', 'review'] }
 * ```
 *
 * @public
 */
export interface AttributeMembership {
  /** Dotted path — `principal.*`, `resource.*` or `env.*`. */
  readonly path: string;
  /** See {@link MembershipOperator}. */
  readonly op: MembershipOperator;
  /** The list to test membership against. Must be non-empty. */
  readonly value: readonly JsonPrimitive[];
}

/**
 * Compare two attributes against each other. This is the shape every
 * ownership and tenancy rule reduces to.
 *
 * @example
 * ```ts
 * { path: 'resource.authorId', op: 'eq', ref: 'principal.id' }
 * { path: 'principal.id', op: 'in', ref: 'resource.editorIds' }
 * ```
 *
 * @public
 */
export interface AttributeReference {
  /** Dotted path for the left operand. */
  readonly path: string;
  /** See {@link BinaryOperator}. */
  readonly op: BinaryOperator;
  /** Dotted path for the right operand. */
  readonly ref: string;
}

/**
 * Test whether an attribute has a value.
 *
 * @remarks
 * `exists` is `true` only when the attribute resolves to a non-null,
 * finite value; `notExists` is its exact complement. Both answer
 * `unknown` — not `true`, not `false` — when the attribute's *root* was
 * never supplied, because "I was not given the resource" is not the same
 * fact as "the resource has no such field".
 *
 * @example
 * ```ts
 * { path: 'resource.deletedAt', op: 'notExists' }
 * { path: 'principal.id', op: 'exists' }        // i.e. "is authenticated"
 * ```
 *
 * @public
 */
export interface AttributePresence {
  /** Dotted path — `principal.*`, `resource.*` or `env.*`. */
  readonly path: string;
  /** See {@link PresenceOperator}. */
  readonly op: PresenceOperator;
}

/**
 * Conjunction. `false` if any operand is `false`, else `unknown` if any
 * is `unknown`, else `true`.
 *
 * @public
 */
export interface AllOf {
  /** Operands. Must be non-empty — an empty `all` is a policy error, not a tautology. */
  readonly all: readonly Condition[];
}

/**
 * Disjunction. `true` if any operand is `true`, else `unknown` if any is
 * `unknown`, else `false`.
 *
 * @public
 */
export interface AnyOf {
  /** Operands. Must be non-empty — an empty `any` is a policy error, not a contradiction. */
  readonly any: readonly Condition[];
}

/**
 * Negation, in three-valued logic: `unknown` negates to `unknown`.
 *
 * @remarks
 * That is deliberate and it is the reason `not` is safe to expose.
 * Under ordinary boolean negation, a `not` wrapping
 * `resource.locked eq true` would evaluate to `true` for a caller who
 * supplied no resource at all, turning a missing attribute into a
 * granted permission.
 *
 * @public
 */
export interface NotCondition {
  /** The negated condition. */
  readonly not: Condition;
}

/**
 * A portable, JSON-serializable predicate over the `principal`,
 * `resource` and `env` attributes of one permission check.
 *
 * @public
 */
export type Condition =
  | AttributeComparison
  | AttributeMembership
  | AttributeReference
  | AttributePresence
  | AllOf
  | AnyOf
  | NotCondition;

/**
 * The ownership condition, spelled out so you cannot spell it wrong.
 *
 * @param resourceField - The field on the resource that names its owner.
 * Defaults to `ownerId`.
 * @param principalField - The field on the principal to match it
 * against. Defaults to `id`.
 * @returns The equivalent {@link AttributeReference} — ordinary policy
 * data, serializable like any other condition.
 *
 * @remarks
 * This is sugar, not a special case: the engine has no notion of
 * ownership, only of comparing two attributes. What the sugar buys is
 * that the two failure modes people actually hit — writing the
 * comparison against a literal instead of a path, and letting two
 * `undefined`s match — are both impossible to reach from here. A
 * resource with no owner, or a caller with no id, makes this condition
 * `unknown`, and `unknown` never grants.
 *
 * @example
 * ```ts
 * { effect: 'allow', actions: ['update'], subjects: ['post'],
 *   roles: ['author'], when: owns('authorId') }
 * ```
 *
 * @public
 */
export function owns(resourceField = 'ownerId', principalField = 'id'): AttributeReference {
  return {
    path: `resource.${resourceField}`,
    op: 'eq',
    ref: `principal.${principalField}`,
  };
}
