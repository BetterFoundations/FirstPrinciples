import type { BinaryOperator, Condition, JsonPrimitive } from '../conditions.js';
import type { Effect, Policy, Rule } from '../policy.js';
import { FORBIDDEN_SEGMENTS, PATH_ROOTS } from './resolve.js';

/**
 * Policy validation and normalization.
 *
 * Validation is not schema pedantry here; it is half of the
 * deny-by-default guarantee. The engine denies any action or subject the
 * policy does not declare, which turns a typo at a *call site* into a
 * safe denial. The other half is this file: a typo inside a *rule* —
 * `subjects: ['pots']` — would otherwise produce a rule that silently
 * never matches, which is a missing permission at best and a missing
 * `deny` at worst. Both halves are needed for "unknown means denied" to
 * be a property rather than a hope.
 *
 * Every issue is collected before returning, so a policy with three
 * typos reports three, not the first.
 */

/** Maximum nesting depth of `all`/`any`/`not` in one condition. */
const MAX_CONDITION_DEPTH = 32;

const COMPARISON_OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'] as const;
const MEMBERSHIP_OPERATORS = ['in', 'nin'] as const;
const PRESENCE_OPERATORS = ['exists', 'notExists'] as const;

/** One thing wrong with a policy, located within it. */
export interface PolicyIssue {
  /** Where, in `rules[2].when.all[0].path` form. */
  readonly path: string;
  /** What is wrong, and where practical, what to do instead. */
  readonly message: string;
}

/** The outcome of validating an untrusted policy value. */
export interface ValidationOutcome {
  /** The normalized, deep-copied policy — present only when `issues` is empty. */
  readonly policy: Policy | undefined;
  /** Every problem found, not just the first. */
  readonly issues: readonly PolicyIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is JsonPrimitive {
  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean';
}

/** Reads a property without inheriting one from a polluted prototype. */
function own(record: Record<string, unknown>, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  // Own-property read, key from a fixed literal set in this file.
  // eslint-disable-next-line security/detect-object-injection
  return record[key];
}

class IssueCollector {
  readonly issues: PolicyIssue[] = [];

  add(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  get ok(): boolean {
    return this.issues.length === 0;
  }
}

/**
 * Validates and de-duplicates a declared name list (`actions`,
 * `subjects`).
 *
 * @returns The de-duplicated names, order preserved.
 */
function readNameList(value: unknown, path: string, issues: IssueCollector): string[] {
  if (!Array.isArray(value)) {
    issues.add(path, 'Must be an array of names.');
    return [];
  }
  if (value.length === 0) {
    issues.add(
      path,
      'Must declare at least one name. An empty universe denies everything, which is almost never what was meant.',
    );
    return [];
  }
  const names: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      issues.add(`${path}[${index}]`, 'Must be a non-empty string.');
      return;
    }
    if (entry === '*') {
      issues.add(
        `${path}[${index}]`,
        "'*' cannot be declared as a name — it is the wildcard a rule uses to match every one of them.",
      );
      return;
    }
    if (!names.includes(entry)) names.push(entry);
  });
  return names;
}

/** Validates a dotted attribute path. */
function checkPath(value: unknown, path: string, issues: IssueCollector): void {
  if (typeof value !== 'string' || value.length === 0) {
    issues.add(path, 'Must be a non-empty dotted path.');
    return;
  }
  const [root, ...rest] = value.split('.');
  if (root === undefined || !(PATH_ROOTS as readonly string[]).includes(root)) {
    issues.add(path, `Path must start with one of: ${PATH_ROOTS.join(', ')}. Got '${value}'.`);
    return;
  }
  if (rest.length === 0) {
    issues.add(path, `'${value}' addresses a root with no attribute. Write '${value}.<field>'.`);
    return;
  }
  for (const segment of rest) {
    if (segment.length === 0) {
      issues.add(path, `'${value}' has an empty segment.`);
      return;
    }
    if (FORBIDDEN_SEGMENTS.includes(segment)) {
      issues.add(path, `'${segment}' is not a walkable segment.`);
      return;
    }
  }
}

const COMBINATOR_KEYS = ['all', 'any', 'not'] as const;
const LEAF_KEYS = ['path', 'op', 'value', 'ref'] as const;

/**
 * Validates one condition and returns a normalized deep copy of it.
 *
 * @remarks
 * Rebuilding rather than reusing the caller's objects is deliberate:
 * the returned policy must not alias anything the caller can still
 * mutate after `definePolicy` has already frozen and validated it.
 */
function checkCondition(
  value: unknown,
  path: string,
  depth: number,
  issues: IssueCollector,
): Condition | undefined {
  if (depth > MAX_CONDITION_DEPTH) {
    issues.add(path, `Nested deeper than ${MAX_CONDITION_DEPTH} levels.`);
    return undefined;
  }
  if (!isRecord(value)) {
    issues.add(path, 'Must be a condition object.');
    return undefined;
  }

  const keys = Object.keys(value);
  const combinator = COMBINATOR_KEYS.filter((key) => keys.includes(key));
  if (combinator.length > 1) {
    issues.add(
      path,
      `Has more than one of ${COMBINATOR_KEYS.join('/')}: ${combinator.join(', ')}.`,
    );
    return undefined;
  }

  if (combinator[0] === 'not') {
    if (keys.length > 1) {
      issues.add(
        path,
        `'not' must be the only key. Extra: ${keys.filter((k) => k !== 'not').join(', ')}.`,
      );
      return undefined;
    }
    const inner = checkCondition(own(value, 'not'), `${path}.not`, depth + 1, issues);
    return inner === undefined ? undefined : { not: inner };
  }

  if (combinator[0] === 'all' || combinator[0] === 'any') {
    const key = combinator[0];
    if (keys.length > 1) {
      issues.add(
        path,
        `'${key}' must be the only key. Extra: ${keys.filter((k) => k !== key).join(', ')}.`,
      );
      return undefined;
    }
    const operands = own(value, key);
    if (!Array.isArray(operands)) {
      issues.add(`${path}.${key}`, 'Must be an array of conditions.');
      return undefined;
    }
    if (operands.length === 0) {
      issues.add(
        `${path}.${key}`,
        `An empty '${key}' has no meaning here — write the condition you meant, or omit 'when'.`,
      );
      return undefined;
    }
    const inner = operands.map((operand, index) =>
      checkCondition(operand, `${path}.${key}[${index}]`, depth + 1, issues),
    );
    if (inner.some((entry) => entry === undefined)) return undefined;
    const operandsOut = inner as Condition[];
    return key === 'all' ? { all: operandsOut } : { any: operandsOut };
  }

  const extra = keys.filter((key) => !(LEAF_KEYS as readonly string[]).includes(key));
  if (extra.length > 0) {
    issues.add(path, `Unrecognized ${extra.length === 1 ? 'key' : 'keys'}: ${extra.join(', ')}.`);
    return undefined;
  }

  checkPath(own(value, 'path'), `${path}.path`, issues);
  const leftPath = own(value, 'path');
  const op = own(value, 'op');
  const hasValue = keys.includes('value');
  const hasRef = keys.includes('ref');

  if ((PRESENCE_OPERATORS as readonly unknown[]).includes(op)) {
    if (hasValue || hasRef) {
      issues.add(path, `'${String(op)}' takes no 'value' or 'ref'.`);
      return undefined;
    }
    if (typeof leftPath !== 'string') return undefined;
    return { path: leftPath, op: op as 'exists' | 'notExists' };
  }

  const isComparison = (COMPARISON_OPERATORS as readonly unknown[]).includes(op);
  const isMembership = (MEMBERSHIP_OPERATORS as readonly unknown[]).includes(op);
  if (!isComparison && !isMembership) {
    issues.add(
      `${path}.op`,
      `Unknown operator ${JSON.stringify(op)}. Expected one of: ${[
        ...COMPARISON_OPERATORS,
        ...MEMBERSHIP_OPERATORS,
        ...PRESENCE_OPERATORS,
      ].join(', ')}.`,
    );
    return undefined;
  }

  if (hasValue === hasRef) {
    issues.add(
      path,
      hasValue
        ? "Has both 'value' and 'ref'. A comparison takes exactly one right-hand operand."
        : "Needs exactly one of 'value' (a literal) or 'ref' (another attribute path).",
    );
    return undefined;
  }

  if (typeof leftPath !== 'string') return undefined;

  if (hasRef) {
    const ref = own(value, 'ref');
    checkPath(ref, `${path}.ref`, issues);
    if (typeof ref !== 'string') return undefined;
    return { path: leftPath, op: op as BinaryOperator, ref };
  }

  const literal = own(value, 'value');
  if (isMembership) {
    if (!Array.isArray(literal) || literal.length === 0 || !literal.every(isPrimitive)) {
      issues.add(
        `${path}.value`,
        `'${String(op)}' needs a non-empty array of strings, numbers or booleans.`,
      );
      return undefined;
    }
    return { path: leftPath, op: op as 'in' | 'nin', value: [...literal] };
  }

  if (!isPrimitive(literal)) {
    issues.add(
      `${path}.value`,
      `Must be a string, number or boolean. To test whether an attribute is set at all, use 'exists' or 'notExists'.`,
    );
    return undefined;
  }
  if (typeof literal === 'number' && !Number.isFinite(literal)) {
    issues.add(
      `${path}.value`,
      'Must be a finite number — NaN and Infinity do not survive JSON, so a policy containing one would decide differently on each side of the wire.',
    );
    return undefined;
  }
  return {
    path: leftPath,
    op: op as 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains',
    value: literal,
  };
}

/** Validates one rule and returns a normalized deep copy of it. */
function checkRule(
  value: unknown,
  path: string,
  actions: readonly string[],
  subjects: readonly string[],
  roles: readonly string[],
  issues: IssueCollector,
): Rule | undefined {
  if (!isRecord(value)) {
    issues.add(path, 'Must be a rule object.');
    return undefined;
  }
  const issuesBefore = issues.issues.length;

  const effect = own(value, 'effect');
  if (effect !== 'allow' && effect !== 'deny') {
    issues.add(
      `${path}.effect`,
      `Must be 'allow' or 'deny'. There is no default: a rule whose effect has to be guessed is a rule nobody can audit.`,
    );
  }

  const selector = (
    key: 'actions' | 'subjects',
    declared: readonly string[],
  ): readonly string[] | '*' | undefined => {
    const raw = own(value, key);
    if (raw === '*') return '*';
    if (!Array.isArray(raw)) {
      issues.add(`${path}.${key}`, `Must be an array of declared ${key}, or '*'.`);
      return undefined;
    }
    if (raw.length === 0) {
      issues.add(
        `${path}.${key}`,
        `Is empty, so this rule can never match. Use '*' to mean every one.`,
      );
      return undefined;
    }
    const out: string[] = [];
    raw.forEach((entry, index) => {
      if (typeof entry !== 'string') {
        issues.add(`${path}.${key}[${index}]`, 'Must be a string.');
        return;
      }
      if (!declared.includes(entry)) {
        issues.add(
          `${path}.${key}[${index}]`,
          `'${entry}' is not declared in the policy's ${key}. Declared: ${declared.join(', ')}.`,
        );
        return;
      }
      if (!out.includes(entry)) out.push(entry);
    });
    return out;
  };

  const ruleActions = selector('actions', actions);
  const ruleSubjects = selector('subjects', subjects);

  let ruleRoles: string[] | undefined;
  if (Object.prototype.hasOwnProperty.call(value, 'roles')) {
    const raw = own(value, 'roles');
    if (!Array.isArray(raw)) {
      issues.add(
        `${path}.roles`,
        'Must be an array of declared roles. Omit it entirely to apply the rule to every caller, anonymous included.',
      );
    } else if (raw.length === 0) {
      issues.add(
        `${path}.roles`,
        'Is empty, so this rule can never match. Omit it to apply the rule to every caller.',
      );
    } else {
      ruleRoles = [];
      raw.forEach((entry, index) => {
        if (typeof entry !== 'string') {
          issues.add(`${path}.roles[${index}]`, 'Must be a string.');
          return;
        }
        if (!roles.includes(entry)) {
          issues.add(
            `${path}.roles[${index}]`,
            `'${entry}' is not a declared role. Declared: ${roles.length > 0 ? roles.join(', ') : '(none)'}.`,
          );
          return;
        }
        if (ruleRoles !== undefined && !ruleRoles.includes(entry)) ruleRoles.push(entry);
      });
    }
  }

  let when: Condition | undefined;
  if (Object.prototype.hasOwnProperty.call(value, 'when')) {
    when = checkCondition(own(value, 'when'), `${path}.when`, 1, issues);
  }

  let id: string | undefined;
  if (Object.prototype.hasOwnProperty.call(value, 'id')) {
    const raw = own(value, 'id');
    if (typeof raw !== 'string' || raw.length === 0) {
      issues.add(`${path}.id`, 'Must be a non-empty string when present.');
    } else {
      id = raw;
    }
  }

  let description: string | undefined;
  if (Object.prototype.hasOwnProperty.call(value, 'description')) {
    const raw = own(value, 'description');
    if (typeof raw !== 'string') {
      issues.add(`${path}.description`, 'Must be a string when present.');
    } else {
      description = raw;
    }
  }

  const extra = Object.keys(value).filter(
    (key) => !['id', 'description', 'effect', 'actions', 'subjects', 'roles', 'when'].includes(key),
  );
  if (extra.length > 0) {
    issues.add(path, `Unrecognized ${extra.length === 1 ? 'key' : 'keys'}: ${extra.join(', ')}.`);
  }

  // Anything wrong with *this* rule means there is no normalized rule to
  // return. Rules validated after it still get their own issues collected.
  if (issues.issues.length > issuesBefore) return undefined;
  // Unreachable: both are only `undefined` when `selector` recorded an
  // issue, which the line above has already returned on. Kept because
  // the compiler cannot see that, and narrowing by assertion would be
  // worse than a branch that costs nothing.
  /* c8 ignore next */
  if (ruleActions === undefined || ruleSubjects === undefined) return undefined;

  return {
    ...(id === undefined ? {} : { id }),
    ...(description === undefined ? {} : { description }),
    effect: effect as Effect,
    actions: ruleActions,
    subjects: ruleSubjects,
    ...(ruleRoles === undefined ? {} : { roles: ruleRoles }),
    ...(when === undefined ? {} : { when }),
  };
}

/** Reads the `roles` declaration in either supported shape, normalized to the map form. */
function readRoles(value: unknown, issues: IssueCollector): Record<string, readonly string[]> {
  if (value === undefined) return {};

  const inherits: Record<string, string[]> = Object.create(null) as Record<string, string[]>;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (typeof entry !== 'string' || entry.length === 0) {
        issues.add(`roles[${index}]`, 'Must be a non-empty string.');
        return;
      }
      // A write keyed by a declared role name that has just been
      // checked to be a non-empty string, onto a null-prototype object.
      // eslint-disable-next-line security/detect-object-injection
      inherits[entry] = [];
    });
    return inherits;
  }

  if (!isRecord(value)) {
    issues.add(
      'roles',
      'Must be an array of role names, or a map from each role to the roles it inherits.',
    );
    return {};
  }

  for (const role of Object.keys(value)) {
    if (role.length === 0) {
      issues.add('roles', 'A role name may not be empty.');
      continue;
    }
    if (FORBIDDEN_SEGMENTS.includes(role)) {
      issues.add(`roles.${role}`, `'${role}' is not usable as a role name.`);
      continue;
    }
    // Same as above: a null-prototype object, keyed by a role name
    // already rejected if it was empty or a prototype-walking segment.
    // eslint-disable-next-line security/detect-object-injection
    inherits[role] = [];
  }

  for (const role of Object.keys(inherits)) {
    const parents = own(value, role);
    if (!Array.isArray(parents)) {
      issues.add(`roles.${role}`, 'Must be an array of the roles it inherits (use [] for none).');
      continue;
    }
    parents.forEach((parent, index) => {
      if (typeof parent !== 'string') {
        issues.add(`roles.${role}[${index}]`, 'Must be a string.');
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(inherits, parent)) {
        issues.add(`roles.${role}[${index}]`, `'${parent}' is not a declared role.`);
        return;
      }
      // eslint-disable-next-line security/detect-object-injection
      const list = inherits[role];
      if (list !== undefined && !list.includes(parent)) list.push(parent);
    });
  }

  return inherits;
}

/**
 * Validates an untrusted value as a policy and returns a normalized,
 * fully deep-copied one.
 *
 * @param input - Anything: a hand-authored definition, or a
 * `JSON.parse` of something that arrived over the network.
 */
export function validatePolicy(input: unknown): ValidationOutcome {
  const issues = new IssueCollector();

  if (!isRecord(input)) {
    issues.add('', 'A policy must be an object with actions, subjects and rules.');
    return { policy: undefined, issues: issues.issues };
  }

  const actions = readNameList(own(input, 'actions'), 'actions', issues);
  const subjects = readNameList(own(input, 'subjects'), 'subjects', issues);
  const roleGraph = readRoles(own(input, 'roles'), issues);
  const roleNames = Object.keys(roleGraph);

  const rawRules = own(input, 'rules');
  const rules: Rule[] = [];
  if (!Array.isArray(rawRules)) {
    issues.add('rules', 'Must be an array. Use [] for a policy that denies everything.');
  } else {
    const seenIds = new Set<string>();
    rawRules.forEach((rule, index) => {
      const checked = checkRule(rule, `rules[${index}]`, actions, subjects, roleNames, issues);
      if (checked === undefined) return;
      if (checked.id !== undefined) {
        if (seenIds.has(checked.id)) {
          issues.add(
            `rules[${index}].id`,
            `Duplicate rule id '${checked.id}'. Ids name the rule that decided a request; two rules cannot share one.`,
          );
          return;
        }
        seenIds.add(checked.id);
      }
      rules.push(checked);
    });
  }

  const extra = Object.keys(input).filter(
    (key) => !['actions', 'subjects', 'roles', 'rules'].includes(key),
  );
  if (extra.length > 0) {
    issues.add('', `Unrecognized ${extra.length === 1 ? 'key' : 'keys'}: ${extra.join(', ')}.`);
  }

  if (!issues.ok) return { policy: undefined, issues: issues.issues };

  return {
    policy: {
      actions,
      subjects,
      roles: { ...roleGraph },
      rules,
    },
    issues: [],
  };
}
