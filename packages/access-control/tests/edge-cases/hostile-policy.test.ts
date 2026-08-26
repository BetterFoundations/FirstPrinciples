import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@firstprinciples/core';
import {
  createAccessControl,
  parsePolicy,
  type Condition,
  type PolicyIssue,
} from '../../src/index.js';
import { evaluateCondition } from '../../src/internal/evaluate.js';

/**
 * `parsePolicy` takes `unknown`, because in the one place it matters the
 * input really is unknown: a policy fetched over the network, read from
 * a config file, or restored from `localStorage`.
 *
 * So every shape below is a policy that a `JSON.parse` could plausibly
 * hand over, and none of them may crash the parser, throw, or produce a
 * policy. The failure mode being guarded against is not a bad error
 * message — it is a malformed rule that validates into something the
 * engine then treats as a grant.
 */

function issuesOf(input: unknown): readonly PolicyIssue[] {
  const result = parsePolicy(input);
  if (isOk(result)) return [];
  return (result.error.details as { issues: readonly PolicyIssue[] }).issues;
}

function firstMessage(input: unknown): string {
  return issuesOf(input)[0]?.message ?? '(accepted)';
}

const base = { actions: ['read'], subjects: ['post'] };
const withRule = (rule: unknown) => ({ ...base, rules: [rule] });
const withWhen = (when: unknown) =>
  withRule({ effect: 'allow', actions: ['read'], subjects: ['post'], when });

describe('malformed rules', () => {
  it.each([
    ['a rule that is a string', withRule('allow everything'), /Must be a rule object/],
    ['a rule that is an array', withRule([]), /Must be a rule object/],
    ['a rule that is null', withRule(null), /Must be a rule object/],
    [
      'actions as a bare string',
      withRule({ effect: 'allow', actions: 'read', subjects: ['post'] }),
      /Must be an array of declared actions, or '\*'/,
    ],
    [
      'a non-string action entry',
      withRule({ effect: 'allow', actions: [7], subjects: ['post'] }),
      /Must be a string/,
    ],
    [
      'subjects as an object',
      withRule({ effect: 'allow', actions: ['read'], subjects: { post: true } }),
      /Must be an array of declared subjects/,
    ],
    [
      'roles as a bare string',
      withRule({ effect: 'allow', actions: ['read'], subjects: ['post'], roles: 'admin' }),
      /Must be an array of declared roles/,
    ],
    [
      'a non-string role entry',
      withRule({ effect: 'allow', actions: ['read'], subjects: ['post'], roles: [7] }),
      /Must be a string/,
    ],
    [
      'a role when the policy declares none',
      withRule({ effect: 'allow', actions: ['read'], subjects: ['post'], roles: ['admin'] }),
      /Declared: \(none\)/,
    ],
    [
      'a non-string description',
      withRule({ effect: 'allow', actions: ['read'], subjects: ['post'], description: 7 }),
      /Must be a string when present/,
    ],
    [
      'an unrecognized rule key',
      withRule({ effect: 'allow', actions: ['read'], subjects: ['post'], priority: 10 }),
      /Unrecognized key: priority/,
    ],
    [
      'several unrecognized rule keys',
      withRule({ effect: 'allow', actions: ['read'], subjects: ['post'], priority: 1, weight: 2 }),
      /Unrecognized keys: priority, weight/,
    ],
  ])('rejects %s', (_name, input, pattern) => {
    expect(firstMessage(input)).toMatch(pattern);
  });

  it('de-duplicates repeated entries rather than rejecting them', () => {
    const result = parsePolicy({
      actions: ['read'],
      subjects: ['post'],
      roles: { admin: ['editor', 'editor'], editor: [] },
      rules: [
        {
          effect: 'allow',
          actions: ['read', 'read'],
          subjects: ['post', 'post'],
          roles: ['admin', 'admin'],
        },
      ],
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.rules[0]).toMatchObject({
      actions: ['read'],
      subjects: ['post'],
      roles: ['admin'],
    });
    expect(result.value.roles['admin']).toEqual(['editor']);
  });
});

describe('malformed conditions', () => {
  it.each([
    ['a numeric path', { path: 7, op: 'eq', value: 'x' }, /Must be a non-empty dotted path/],
    [
      'a numeric path on a presence check',
      { path: 7, op: 'exists' },
      /Must be a non-empty dotted path/,
    ],
    ['a numeric ref', { path: 'resource.a', op: 'eq', ref: 7 }, /Must be a non-empty dotted path/],
    ['an all that is not an array', { all: 'everything' }, /Must be an array of conditions/],
    ['an any that is not an array', { any: 7 }, /Must be an array of conditions/],
    [
      'an all containing a broken operand',
      { all: [{ path: 'resource.a', op: 'nope', value: 1 }] },
      /Unknown operator/,
    ],
    [
      'a not wrapping a broken condition',
      { not: { path: 'bad.a', op: 'eq', value: 1 } },
      /Path must start with one of/,
    ],
    [
      'several unrecognized leaf keys',
      { path: 'resource.a', op: 'exists', mode: 'loose', strict: false },
      /Unrecognized keys: mode, strict/,
    ],
  ])('rejects %s', (_name, when, pattern) => {
    expect(firstMessage(withWhen(when))).toMatch(pattern);
  });

  it.each([
    [
      'all',
      {
        all: [
          { path: 'resource.a', op: 'exists' },
          { path: 'resource.b', op: 'notExists' },
        ],
      },
    ],
    [
      'any',
      {
        any: [
          { path: 'resource.a', op: 'exists' },
          { path: 'resource.b', op: 'notExists' },
        ],
      },
    ],
  ])('accepts a valid %s and keeps its shape', (key, when) => {
    const result = parsePolicy(withWhen(when));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.rules[0]?.when).toEqual(when);
    expect(Object.keys(result.value.rules[0]?.when ?? {})).toEqual([key]);
  });

  it('accepts a membership condition and normalizes its list', () => {
    const result = parsePolicy(withWhen({ path: 'resource.status', op: 'in', value: ['a', 'b'] }));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.rules[0]?.when).toEqual({
      path: 'resource.status',
      op: 'in',
      value: ['a', 'b'],
    });
  });
});

describe('malformed role declarations', () => {
  it.each([
    ['roles as a bare string', 'admin', /Must be an array of role names, or a map/],
    ['roles as a number', 7, /Must be an array of role names, or a map/],
    ['a non-string name in the list form', ['admin', 7], /Must be a non-empty string/],
    ['an empty name in the list form', ['admin', ''], /Must be a non-empty string/],
    ['inheritance that is not an array', { admin: 'editor', editor: [] }, /use \[\] for none/],
    ['a non-string inherited name', { admin: [7], editor: [] }, /Must be a string/],
  ])('rejects %s', (_name, roles, pattern) => {
    expect(firstMessage({ ...base, roles, rules: [] })).toMatch(pattern);
  });

  it('lists the declared roles when a rule names one that is not among them', () => {
    expect(
      firstMessage({
        ...base,
        roles: ['author', 'editor'],
        rules: [{ effect: 'allow', actions: ['read'], subjects: ['post'], roles: ['admin'] }],
      }),
    ).toMatch(/'admin' is not a declared role\. Declared: author, editor\./);
  });

  it('rejects an empty role name in the map form', () => {
    expect(firstMessage({ ...base, roles: JSON.parse('{"":[]}') as unknown, rules: [] })).toMatch(
      /may not be empty/,
    );
  });

  it('rejects a role named __proto__, which a JSON payload can really carry', () => {
    // Written via JSON.parse because an object *literal* with a
    // `__proto__` key sets the prototype instead of creating the
    // property — the wire form is the one that reaches this code.
    const roles = JSON.parse('{"__proto__":[],"admin":[]}') as unknown;
    expect(firstMessage({ ...base, roles, rules: [] })).toMatch(/not usable as a role name/);
  });

  it('accepts the list form and gives every role an empty inheritance list', () => {
    const result = parsePolicy({ ...base, roles: ['a', 'b'], rules: [] });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.roles).toEqual({ a: [], b: [] });
  });
});

describe('malformed policies', () => {
  it.each([
    ['null', null, /must be an object/],
    ['an array', [], /must be an object/],
    ['a number', 7, /must be an object/],
    [
      'several unrecognized top-level keys',
      { ...base, rules: [], version: 1, name: 'x' },
      /Unrecognized keys: version, name/,
    ],
  ])('rejects %s', (_name, input, pattern) => {
    expect(firstMessage(input)).toMatch(pattern);
  });

  it('never throws, whatever it is handed', () => {
    const nasty: unknown[] = [
      undefined,
      Number.NaN,
      Symbol('policy'),
      () => 'policy',
      new Map(),
      JSON.parse('{"__proto__":{"isAdmin":true}}'),
      { actions: ['read'], subjects: ['post'], rules: [{}] },
    ];
    for (const input of nasty) {
      expect(() => parsePolicy(input)).not.toThrow();
      expect(isErr(parsePolicy(input))).toBe(true);
    }
  });
});

describe('a forged condition that bypassed validation still cannot grant', () => {
  const environment = { principal: { id: 'u1' }, resource: { a: 'x' }, env: undefined };

  it('an unrecognized operator evaluates to unknown', () => {
    // Only reachable by hand-building a Condition and casting past the
    // parser. `unknown` is the safe answer at either effect.
    const forged = { path: 'resource.a', op: 'matches', value: 'x' } as unknown as Condition;
    expect(evaluateCondition(forged, environment)).toBe('unknown');
  });

  it('a binary operator with neither value nor ref evaluates to unknown', () => {
    const forged = { path: 'resource.a', op: 'eq' } as unknown as Condition;
    expect(evaluateCondition(forged, environment)).toBe('unknown');
  });

  it('a ref pointing at a non-primitive evaluates to unknown', () => {
    const condition: Condition = { path: 'resource.a', op: 'eq', ref: 'resource.nested' };
    expect(
      evaluateCondition(condition, { ...environment, resource: { a: 'x', nested: { b: 1 } } }),
    ).toBe('unknown');
  });

  it('and the engine denies for all of them', () => {
    const result = parsePolicy({
      actions: ['read'],
      subjects: ['post'],
      rules: [
        {
          effect: 'allow',
          actions: ['read'],
          subjects: ['post'],
          when: { path: 'resource.a', op: 'exists' },
        },
      ],
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // Forge the operator on the frozen policy's own rule — it cannot be
    // done, which is the point of freezing.
    expect(() => {
      (result.value.rules[0] as unknown as { when: unknown }).when = { path: 'x', op: 'nope' };
    }).toThrow(TypeError);
    expect(createAccessControl(result.value).for(null).can('read', 'post')).toBe(false);
  });
});
