/**
 * Role inheritance, resolved once at `createAccessControl` time.
 *
 * Inheritance is transitive and cycle-tolerant. A cycle
 * (`a -\> b -\> a`) is not rejected: it simply makes those roles
 * equivalent, which is a modelling oddity rather than a security
 * problem, and rejecting it would add a startup failure mode with no
 * safety payoff. The visited set is what guarantees termination.
 */

/**
 * Expands every declared role to the full set of roles it stands in for,
 * including itself.
 *
 * @param inherits - Declared role graph: role name to the roles it
 * inherits.
 * @returns One closed set per declared role.
 */
export function buildRoleClosures(
  inherits: Readonly<Record<string, readonly string[]>>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const closures = new Map<string, ReadonlySet<string>>();
  for (const role of Object.keys(inherits)) {
    const reached = new Set<string>();
    const pending = [role];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || reached.has(current)) continue;
      reached.add(current);
      // Only declared roles can be inherited — `definePolicy` rejects a
      // reference to an undeclared one — so a missing entry here means
      // the graph came from somewhere else and is simply a leaf.
      const parents = Object.prototype.hasOwnProperty.call(inherits, current)
        ? // eslint-disable-next-line security/detect-object-injection
          inherits[current]
        : undefined;
      if (parents !== undefined) pending.push(...parents);
    }
    closures.set(role, reached);
  }
  return closures;
}

/** A principal's roles, split into what the policy knows and what it does not. */
export interface EffectiveRoles {
  /** Every declared role this principal holds, inheritance included. */
  readonly roles: ReadonlySet<string>;
  /**
   * Roles the principal claims that the policy never declared.
   *
   * @remarks
   * They are ignored — no rule can reference an undeclared role, so they
   * can neither grant nor deny. They are reported rather than dropped
   * because the usual cause is drift between the token issuer and the
   * policy (`'Admin'` against a declared `'admin'`), and the symptom of
   * that drift — a rule that quietly never matches — is otherwise
   * invisible. Surfaced on `explain()`, never on a thrown error.
   */
  readonly unknown: readonly string[];
}

const NO_ROLES: ReadonlySet<string> = new Set<string>();

/**
 * Resolves the roles one principal actually holds under this policy.
 *
 * @param closures - From {@link buildRoleClosures}.
 * @param claimed - `principal.roles`, straight off whatever produced the
 * principal. Not trusted to be an array.
 *
 * @remarks
 * Role names are matched **exactly**. Nothing is lower-cased or trimmed:
 * silently normalizing `'Admin'` to `'admin'` would make the policy's
 * meaning depend on a transformation the policy file does not show, and
 * the failure it hides (a `deny` rule that never matches) is the
 * dangerous direction.
 */
export function resolveEffectiveRoles(
  closures: ReadonlyMap<string, ReadonlySet<string>>,
  claimed: unknown,
): EffectiveRoles {
  if (!Array.isArray(claimed)) return { roles: NO_ROLES, unknown: [] };

  // Copied index by index inside a `try`, because the principal is the
  // application's own object and nothing stops it being an array with a
  // throwing accessor. A throw here would escape `for()` — and a binding
  // that throws is a binding someone wraps in a `catch` that eventually
  // gets written as "allow". Holding no roles is the fail-closed answer,
  // and it is the same one a non-array `roles` already gets.
  let entries: readonly unknown[];
  try {
    entries = Array.prototype.slice.call(claimed) as unknown[];
  } catch {
    return { roles: NO_ROLES, unknown: [] };
  }

  const roles = new Set<string>();
  const unknown: string[] = [];
  for (const claim of entries) {
    if (typeof claim !== 'string') continue;
    const closure = closures.get(claim);
    if (closure === undefined) {
      if (!unknown.includes(claim)) unknown.push(claim);
      continue;
    }
    for (const role of closure) roles.add(role);
  }
  return { roles, unknown };
}
