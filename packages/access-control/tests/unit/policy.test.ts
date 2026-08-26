import { describe, expect, it } from 'vitest';
import { isErr, isOk, ValidationError } from '@firstprinciples/core';
import {
  createAccessControl,
  definePolicy,
  isPolicy,
  parsePolicy,
  type Policy,
  type PolicyIssue,
} from '../../src/index.js';

/**
 * Policy validation.
 *
 * The rejections below are not schema pedantry. Each one closes a way a
 * policy can be wrong *silently*: a rule that never matches is a missing
 * permission when it was an `allow` and a missing prohibition when it
 * was a `deny`, and neither announces itself at runtime.
 */

/** Runs the validator over a hand-built value and returns the issues. */
function issuesOf(input: unknown): readonly PolicyIssue[] {
  const result = parsePolicy(input);
  if (isOk(result)) return [];
  return (result.error.details as { issues: readonly PolicyIssue[] }).issues;
}

function messagesOf(input: unknown): string {
  return issuesOf(input)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('\n');
}

// `effect` needs `as const` because this literal is held in a variable:
// TypeScript widens `'allow'` to `string` otherwise, and `Rule['effect']`
// is a union. Rules written inline inside `definePolicy(...)` do not need
// it — this is a fixture, not the shape a policy file takes.
const minimal = {
  actions: ['read'],
  subjects: ['post'],
  rules: [{ effect: 'allow' as const, actions: ['read'], subjects: ['post'] }],
};

describe('a valid policy', () => {
  it('is accepted, branded and frozen', () => {
    const policy = definePolicy(minimal);
    expect(isPolicy(policy)).toBe(true);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.rules)).toBe(true);
    expect(Object.isFrozen(policy.rules[0])).toBe(true);
  });

  it('is a deep copy, so mutating the definition afterwards changes nothing', () => {
    const definition = {
      actions: ['read', 'write'],
      subjects: ['post'],
      rules: [{ id: 'r', effect: 'allow' as const, actions: ['read'], subjects: ['post'] }],
    };
    const policy = definePolicy(definition);
    definition.rules[0]!.actions.push('write');
    definition.actions.push('purge');
    expect(policy.rules[0]?.actions).toEqual(['read']);
    expect(policy.actions).toEqual(['read', 'write']);
  });

  it('normalizes both role declaration forms to the same map', () => {
    const asList = definePolicy({ ...minimal, roles: ['admin', 'author'] });
    expect(asList.roles).toEqual({ admin: [], author: [] });

    const asMap = definePolicy({ ...minimal, roles: { admin: ['author'], author: [] } });
    expect(asMap.roles).toEqual({ admin: ['author'], author: [] });
  });

  it('de-duplicates declared names', () => {
    const policy = definePolicy({
      actions: ['read', 'read'],
      subjects: ['post', 'post'],
      rules: [],
    });
    expect(policy.actions).toEqual(['read']);
    expect(policy.subjects).toEqual(['post']);
  });

  it('accepts a policy with no rules at all, which denies everything', () => {
    const policy = definePolicy({ actions: ['read'], subjects: ['post'], rules: [] });
    expect(createAccessControl(policy).for({ id: 'u1' }).can('read', 'post')).toBe(false);
  });

  it('serializes to JSON without the brand', () => {
    const policy = definePolicy(minimal);
    const json = JSON.parse(JSON.stringify(policy)) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(['actions', 'roles', 'rules', 'subjects']);
    expect(isPolicy(json)).toBe(false);
  });
});

describe('typos in a rule are rejected, because a rule that never matches is invisible', () => {
  it.each([
    [
      'an undeclared action',
      { ...minimal, rules: [{ effect: 'allow', actions: ['reed'], subjects: ['post'] }] },
      /'reed' is not declared in the policy's actions/,
    ],
    [
      'an undeclared subject',
      { ...minimal, rules: [{ effect: 'allow', actions: ['read'], subjects: ['pots'] }] },
      /'pots' is not declared in the policy's subjects/,
    ],
    [
      'an undeclared role',
      {
        ...minimal,
        rules: [{ effect: 'allow', actions: ['read'], subjects: ['post'], roles: ['admin'] }],
      },
      /'admin' is not a declared role/,
    ],
    [
      'an undeclared inherited role',
      { ...minimal, roles: { admin: ['editor'] } },
      /'editor' is not a declared role/,
    ],
  ])('%s', (_name, input, pattern) => {
    expect(messagesOf(input)).toMatch(pattern);
  });
});

describe('rules that could never match are rejected', () => {
  it.each([
    [
      'empty actions',
      { ...minimal, rules: [{ effect: 'allow', actions: [], subjects: ['post'] }] },
      /can never match/,
    ],
    [
      'empty subjects',
      { ...minimal, rules: [{ effect: 'allow', actions: ['read'], subjects: [] }] },
      /can never match/,
    ],
    [
      'empty roles',
      {
        ...minimal,
        rules: [{ effect: 'allow', actions: ['read'], subjects: ['post'], roles: [] }],
      },
      /Omit it to apply the rule to every caller/,
    ],
  ])('%s', (_name, input, pattern) => {
    expect(messagesOf(input)).toMatch(pattern);
  });
});

describe('the declared universe must be real', () => {
  it.each([
    ['no actions', { ...minimal, actions: [] }, /at least one name/],
    ['no subjects', { ...minimal, subjects: [] }, /at least one name/],
    ['actions not an array', { ...minimal, actions: 'read' }, /Must be an array of names/],
    [
      "'*' declared as an action",
      { ...minimal, actions: ['read', '*'] },
      /cannot be declared as a name/,
    ],
    ['a non-string action', { ...minimal, actions: ['read', 7] }, /Must be a non-empty string/],
    ['rules not an array', { ...minimal, rules: {} }, /Must be an array/],
    ['not an object at all', 'nope', /must be an object/],
    ['an unrecognized top-level key', { ...minimal, version: 2 }, /Unrecognized key: version/],
  ])('%s', (_name, input, pattern) => {
    expect(messagesOf(input)).toMatch(pattern);
  });
});

describe('effects must be stated', () => {
  it.each([
    ['missing', { ...minimal, rules: [{ actions: ['read'], subjects: ['post'] }] }],
    [
      'misspelled',
      { ...minimal, rules: [{ effect: 'Allow', actions: ['read'], subjects: ['post'] }] },
    ],
    ['null', { ...minimal, rules: [{ effect: null, actions: ['read'], subjects: ['post'] }] }],
  ])('%s', (_name, input) => {
    expect(messagesOf(input)).toMatch(/Must be 'allow' or 'deny'/);
  });
});

describe('conditions are validated structurally', () => {
  const withCondition = (when: unknown) => ({
    ...minimal,
    rules: [{ effect: 'allow', actions: ['read'], subjects: ['post'], when }],
  });

  it.each([
    ['an unknown operator', { path: 'resource.a', op: 'matches', value: 'x' }, /Unknown operator/],
    ['a path with no root', { path: 'a.b', op: 'eq', value: 'x' }, /Path must start with one of/],
    [
      'a bare root',
      { path: 'resource', op: 'eq', value: 'x' },
      /addresses a root with no attribute/,
    ],
    ['an empty segment', { path: 'resource..a', op: 'eq', value: 'x' }, /has an empty segment/],
    [
      'a prototype-walking segment',
      { path: 'resource.__proto__.x', op: 'eq', value: 'x' },
      /not a walkable segment/,
    ],
    [
      'a constructor segment',
      { path: 'resource.constructor.x', op: 'eq', value: 'x' },
      /not a walkable segment/,
    ],
    [
      'both value and ref',
      { path: 'resource.a', op: 'eq', value: 'x', ref: 'principal.id' },
      /both 'value' and 'ref'/,
    ],
    ['neither value nor ref', { path: 'resource.a', op: 'eq' }, /exactly one of 'value'/],
    [
      'a presence operator with a value',
      { path: 'resource.a', op: 'exists', value: 'x' },
      /takes no 'value' or 'ref'/,
    ],
    [
      'an object literal value',
      { path: 'resource.a', op: 'eq', value: { x: 1 } },
      /Must be a string, number or boolean/,
    ],
    [
      'a null literal value',
      { path: 'resource.a', op: 'eq', value: null },
      /use 'exists' or 'notExists'/,
    ],
    [
      'a NaN literal value',
      { path: 'resource.a', op: 'eq', value: Number.NaN },
      /Must be a finite number/,
    ],
    [
      'an in with a non-array value',
      { path: 'resource.a', op: 'in', value: 'x' },
      /non-empty array/,
    ],
    ['an in with an empty array', { path: 'resource.a', op: 'in', value: [] }, /non-empty array/],
    [
      'an in with an object member',
      { path: 'resource.a', op: 'in', value: [{}] },
      /non-empty array/,
    ],
    [
      'a bad ref path',
      { path: 'resource.a', op: 'eq', ref: 'nope.x' },
      /Path must start with one of/,
    ],
    ['an empty all', { all: [] }, /An empty 'all' has no meaning/],
    ['an empty any', { any: [] }, /An empty 'any' has no meaning/],
    [
      'both all and any',
      { all: [{ path: 'resource.a', op: 'exists' }], any: [] },
      /more than one of/,
    ],
    [
      'all with a sibling key',
      { all: [{ path: 'resource.a', op: 'exists' }], path: 'x' },
      /must be the only key/,
    ],
    [
      'not with a sibling key',
      { not: { path: 'resource.a', op: 'exists' }, op: 'eq' },
      /must be the only key/,
    ],
    [
      'an unrecognized leaf key',
      { path: 'resource.a', op: 'exists', mode: 'loose' },
      /Unrecognized key: mode/,
    ],
    ['not a condition object', 'always', /Must be a condition object/],
    ['an array', [], /Must be a condition object/],
  ])('rejects %s', (_name, when, pattern) => {
    expect(messagesOf(withCondition(when))).toMatch(pattern);
  });

  it('rejects a condition nested past the depth limit', () => {
    let when: unknown = { path: 'resource.a', op: 'exists' };
    for (let depth = 0; depth < 40; depth += 1) when = { not: when };
    expect(messagesOf(withCondition(when))).toMatch(/Nested deeper than 32 levels/);
  });

  it('accepts one nested just inside it', () => {
    let when: unknown = { path: 'resource.a', op: 'exists' };
    for (let depth = 0; depth < 30; depth += 1) when = { not: when };
    expect(issuesOf(withCondition(when))).toEqual([]);
  });
});

describe('rule ids', () => {
  it('rejects duplicates, since an id names the rule that decided', () => {
    expect(
      messagesOf({
        ...minimal,
        rules: [
          { id: 'r', effect: 'allow', actions: ['read'], subjects: ['post'] },
          { id: 'r', effect: 'deny', actions: ['read'], subjects: ['post'] },
        ],
      }),
    ).toMatch(/Duplicate rule id 'r'/);
  });

  it('rejects an empty id', () => {
    expect(
      messagesOf({
        ...minimal,
        rules: [{ id: '', effect: 'allow', actions: ['read'], subjects: ['post'] }],
      }),
    ).toMatch(/Must be a non-empty string when present/);
  });
});

describe('every problem is reported, not just the first', () => {
  it('reports one issue per mistake', () => {
    const issues = issuesOf({
      actions: ['read'],
      subjects: ['post'],
      rules: [
        { effect: 'allow', actions: ['reed'], subjects: ['post'] },
        { effect: 'allow', actions: ['read'], subjects: ['pots'] },
        { effect: 'nope', actions: ['read'], subjects: ['post'] },
      ],
    });
    expect(issues).toHaveLength(3);
    expect(issues.map((issue) => issue.path)).toEqual([
      'rules[0].actions[0]',
      'rules[1].subjects[0]',
      'rules[2].effect',
    ]);
  });

  it('summarizes the first three in the message and counts the rest', () => {
    const result = parsePolicy({
      actions: ['read'],
      subjects: ['post'],
      rules: Array.from({ length: 5 }, () => ({
        effect: 'allow',
        actions: ['reed'],
        subjects: ['post'],
      })),
    });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.message).toMatch(/\(\+2 more\)$/);
  });
});

describe('definePolicy throws where parsePolicy returns a Result', () => {
  it('definePolicy throws a ValidationError carrying every issue', () => {
    let thrown: unknown;
    try {
      definePolicy({
        actions: ['read'],
        subjects: ['post'],
        rules: [{ effect: 'allow', actions: ['reed' as 'read'], subjects: ['post'] }],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    expect((thrown as ValidationError).code).toBe('INVALID_POLICY');
    expect((thrown as ValidationError).details).toMatchObject({ issues: expect.any(Array) });
  });

  it('parsePolicy returns err for untrusted input rather than throwing', () => {
    const result = parsePolicy({ nonsense: true });
    expect(isErr(result)).toBe(true);
  });

  it('parsePolicy returns ok for a round-tripped policy', () => {
    const original = definePolicy(minimal);
    const parsed = parsePolicy(JSON.parse(JSON.stringify(original)) as unknown);
    expect(isOk(parsed)).toBe(true);
    if (!isOk(parsed)) return;
    expect(parsed.value).toEqual(original);
    expect(isPolicy(parsed.value)).toBe(true);
  });
});

describe('createAccessControl refuses anything that has not been validated', () => {
  it.each([
    ['a plain object', { actions: ['read'], subjects: ['post'], roles: {}, rules: [] }],
    [
      'a JSON round-trip of a real policy',
      JSON.parse(JSON.stringify(definePolicy(minimal))) as unknown,
    ],
    ['null', null],
    ['a string', 'policy'],
  ])('%s', (_name, value) => {
    expect(() => createAccessControl(value as Policy)).toThrow(
      /definePolicy\(\) or parsePolicy\(\)/,
    );
  });

  it('is not a hypothetical: the wire copy must be re-validated', () => {
    const wire = JSON.parse(JSON.stringify(definePolicy(minimal))) as unknown;
    expect(isPolicy(wire)).toBe(false);
    const reparsed = parsePolicy(wire);
    expect(isOk(reparsed)).toBe(true);
    if (!isOk(reparsed)) return;
    expect(() => createAccessControl(reparsed.value)).not.toThrow();
  });
});
