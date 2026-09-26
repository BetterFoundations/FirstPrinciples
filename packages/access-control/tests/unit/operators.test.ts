import { describe, expect, it } from 'vitest';
import type { Condition } from '../../src/index.js';
import { evaluateCondition } from '../../src/internal/evaluate.js';
import type { AttributeEnvironment } from '../../src/internal/resolve.js';
import type { Ternary } from '../../src/internal/truth.js';

/**
 * Operator truth tables.
 *
 * Every operator is checked against all three operand states — a value,
 * an absent attribute under a supplied root, and a root that was never
 * supplied — and against the type pairings JavaScript would happily
 * coerce. The cells that matter are the ones answering `unknown`: each
 * of them is a comparison the engine refuses to guess at, and refusing
 * is what stops an `allow` from firing on data nobody supplied.
 */

/** `resource` is supplied (so its missing keys are *absent*); `env` never is (so its paths are *unresolved*). */
function evaluate(condition: Condition, resource: Record<string, unknown>): Ternary {
  const environment: AttributeEnvironment = {
    principal: { id: 'u1' },
    resource,
    env: undefined,
  };
  return evaluateCondition(condition, environment);
}

/** A path under the never-supplied `env` root. */
const UNRESOLVED_PATH = 'env.anything';

describe('eq / ne', () => {
  const table: readonly [string, Condition, Record<string, unknown>, Ternary][] = [
    ['equal strings', { path: 'resource.a', op: 'eq', value: 'x' }, { a: 'x' }, 'true'],
    ['different strings', { path: 'resource.a', op: 'eq', value: 'x' }, { a: 'y' }, 'false'],
    ['equal numbers', { path: 'resource.a', op: 'eq', value: 1 }, { a: 1 }, 'true'],
    ['equal booleans', { path: 'resource.a', op: 'eq', value: true }, { a: true }, 'true'],
    [
      'number against its string spelling',
      { path: 'resource.a', op: 'eq', value: 1 },
      { a: '1' },
      'false',
    ],
    ['zero against false', { path: 'resource.a', op: 'eq', value: false }, { a: 0 }, 'false'],
    ['absent attribute', { path: 'resource.a', op: 'eq', value: 'x' }, {}, 'unknown'],
    ['null attribute', { path: 'resource.a', op: 'eq', value: 'x' }, { a: null }, 'unknown'],
    [
      'undefined attribute',
      { path: 'resource.a', op: 'eq', value: 'x' },
      { a: undefined },
      'unknown',
    ],
    ['unsupplied root', { path: UNRESOLVED_PATH, op: 'eq', value: 'x' }, {}, 'unknown'],
    ['object attribute', { path: 'resource.a', op: 'eq', value: 'x' }, { a: { x: 1 } }, 'unknown'],
    ['array attribute', { path: 'resource.a', op: 'eq', value: 'x' }, { a: ['x'] }, 'unknown'],
    ['NaN attribute', { path: 'resource.a', op: 'eq', value: 1 }, { a: Number.NaN }, 'unknown'],
    [
      'Infinity attribute',
      { path: 'resource.a', op: 'eq', value: 1 },
      { a: Number.POSITIVE_INFINITY },
      'unknown',
    ],
    [
      'ref to an equal attribute',
      { path: 'resource.a', op: 'eq', ref: 'principal.id' },
      { a: 'u1' },
      'true',
    ],
    [
      'ref to a different attribute',
      { path: 'resource.a', op: 'eq', ref: 'principal.id' },
      { a: 'u2' },
      'false',
    ],
    [
      'ref to an unresolved root',
      { path: 'resource.a', op: 'eq', ref: UNRESOLVED_PATH },
      { a: 'u1' },
      'unknown',
    ],
  ];

  it.each(table)('eq: %s → %s', (_name, condition, resource, expected) => {
    expect(evaluate(condition, resource)).toBe(expected);
  });

  it.each(table)(
    'ne is the exact complement of eq except on unknown: %s',
    (_name, condition, resource, expected) => {
      const negated = { ...condition, op: 'ne' } as Condition;
      const complement: Ternary =
        expected === 'unknown' ? 'unknown' : expected === 'true' ? 'false' : 'true';
      expect(evaluate(negated, resource)).toBe(complement);
    },
  );
});

describe('gt / gte / lt / lte', () => {
  it.each([
    ['2 > 1', { path: 'resource.a', op: 'gt', value: 1 } as Condition, { a: 2 }, 'true'],
    ['1 > 1', { path: 'resource.a', op: 'gt', value: 1 } as Condition, { a: 1 }, 'false'],
    ['1 >= 1', { path: 'resource.a', op: 'gte', value: 1 } as Condition, { a: 1 }, 'true'],
    ['1 < 2', { path: 'resource.a', op: 'lt', value: 2 } as Condition, { a: 1 }, 'true'],
    ['1 <= 0', { path: 'resource.a', op: 'lte', value: 0 } as Condition, { a: 1 }, 'false'],
    ["'b' > 'a'", { path: 'resource.a', op: 'gt', value: 'a' } as Condition, { a: 'b' }, 'true'],
    [
      'ISO date strings order correctly',
      { path: 'resource.a', op: 'gt', value: '2026-01-01' } as Condition,
      { a: '2026-08-26' },
      'true',
    ],
    // JavaScript would say `'10' > 9` is true. The engine will not.
    [
      'numeric string against a number',
      { path: 'resource.a', op: 'gt', value: 9 } as Condition,
      { a: '10' },
      'unknown',
    ],
    [
      'number against a numeric string',
      { path: 'resource.a', op: 'gt', value: '9' } as Condition,
      { a: 10 },
      'unknown',
    ],
    [
      'booleans do not order',
      { path: 'resource.a', op: 'gt', value: false } as Condition,
      { a: true },
      'unknown',
    ],
    ['absent attribute', { path: 'resource.a', op: 'gt', value: 1 } as Condition, {}, 'unknown'],
    ['unsupplied root', { path: UNRESOLVED_PATH, op: 'gt', value: 1 } as Condition, {}, 'unknown'],
  ] as const)('%s → %s', (_name, condition, resource, expected) => {
    expect(evaluate(condition, resource)).toBe(expected);
  });
});

describe('in / nin', () => {
  it.each([
    [
      'member',
      { path: 'resource.a', op: 'in', value: ['x', 'y'] } as Condition,
      { a: 'x' },
      'true',
    ],
    [
      'not a member',
      { path: 'resource.a', op: 'in', value: ['x', 'y'] } as Condition,
      { a: 'z' },
      'false',
    ],
    [
      'number against string members',
      { path: 'resource.a', op: 'in', value: ['1'] } as Condition,
      { a: 1 },
      'false',
    ],
    [
      'absent attribute',
      { path: 'resource.a', op: 'in', value: ['x'] } as Condition,
      {},
      'unknown',
    ],
    [
      'unsupplied root',
      { path: UNRESOLVED_PATH, op: 'in', value: ['x'] } as Condition,
      {},
      'unknown',
    ],
    [
      'object attribute',
      { path: 'resource.a', op: 'in', value: ['x'] } as Condition,
      { a: {} },
      'unknown',
    ],
    [
      'ref to an array',
      { path: 'principal.id', op: 'in', ref: 'resource.editors' } as Condition,
      { editors: ['u1', 'u2'] },
      'true',
    ],
    [
      'ref to an array without it',
      { path: 'principal.id', op: 'in', ref: 'resource.editors' } as Condition,
      { editors: ['u2'] },
      'false',
    ],
    [
      'ref to a non-array',
      { path: 'principal.id', op: 'in', ref: 'resource.editors' } as Condition,
      { editors: 'u1' },
      'unknown',
    ],
    [
      'ref to an absent attribute',
      { path: 'principal.id', op: 'in', ref: 'resource.editors' } as Condition,
      {},
      'unknown',
    ],
    [
      'ref to an empty array',
      { path: 'principal.id', op: 'in', ref: 'resource.editors' } as Condition,
      { editors: [] },
      'false',
    ],
  ] as const)('in: %s → %s', (_name, condition, resource, expected) => {
    expect(evaluate(condition, resource)).toBe(expected);
  });

  it('nin is the complement of in, and stays unknown where in is unknown', () => {
    expect(evaluate({ path: 'resource.a', op: 'nin', value: ['x'] }, { a: 'z' })).toBe('true');
    expect(evaluate({ path: 'resource.a', op: 'nin', value: ['x'] }, { a: 'x' })).toBe('false');
    expect(evaluate({ path: 'resource.a', op: 'nin', value: ['x'] }, {})).toBe('unknown');
    expect(evaluate({ path: UNRESOLVED_PATH, op: 'nin', value: ['x'] }, {})).toBe('unknown');
  });
});

describe('contains', () => {
  it.each([
    [
      'array holding it',
      { path: 'resource.tags', op: 'contains', value: 'x' } as Condition,
      { tags: ['x', 'y'] },
      'true',
    ],
    [
      'array without it',
      { path: 'resource.tags', op: 'contains', value: 'x' } as Condition,
      { tags: ['y'] },
      'false',
    ],
    [
      'empty array',
      { path: 'resource.tags', op: 'contains', value: 'x' } as Condition,
      { tags: [] },
      'false',
    ],
    [
      'array of objects',
      { path: 'resource.tags', op: 'contains', value: 'x' } as Condition,
      { tags: [{}] },
      'false',
    ],
    // A string is not an array. `contains` is membership, never substring.
    [
      'a string attribute',
      { path: 'resource.tags', op: 'contains', value: 'x' } as Condition,
      { tags: 'xyz' },
      'unknown',
    ],
    [
      'absent attribute',
      { path: 'resource.tags', op: 'contains', value: 'x' } as Condition,
      {},
      'unknown',
    ],
    [
      'unsupplied root',
      { path: UNRESOLVED_PATH, op: 'contains', value: 'x' } as Condition,
      {},
      'unknown',
    ],
  ] as const)('%s → %s', (_name, condition, resource, expected) => {
    expect(evaluate(condition, resource)).toBe(expected);
  });
});

describe('exists / notExists — the only operators that can answer about a missing attribute', () => {
  it.each([
    ['a value', { path: 'resource.a', op: 'exists' } as Condition, { a: 'x' }, 'true'],
    [
      'a falsy value is still a value',
      { path: 'resource.a', op: 'exists' } as Condition,
      { a: 0 },
      'true',
    ],
    [
      'an empty string is still a value',
      { path: 'resource.a', op: 'exists' } as Condition,
      { a: '' },
      'true',
    ],
    [
      'false is still a value',
      { path: 'resource.a', op: 'exists' } as Condition,
      { a: false },
      'true',
    ],
    [
      'a missing key, root supplied',
      { path: 'resource.a', op: 'exists' } as Condition,
      {},
      'false',
    ],
    [
      'null, root supplied',
      { path: 'resource.a', op: 'exists' } as Condition,
      { a: null },
      'false',
    ],
    [
      'NaN, root supplied',
      { path: 'resource.a', op: 'exists' } as Condition,
      { a: Number.NaN },
      'false',
    ],
    // The whole reason `unresolved` is tracked separately from `absent`.
    ['an unsupplied root', { path: UNRESOLVED_PATH, op: 'exists' } as Condition, {}, 'unknown'],
  ] as const)('exists: %s → %s', (_name, condition, resource, expected) => {
    expect(evaluate(condition, resource)).toBe(expected);
  });

  it.each([
    ['a value', { path: 'resource.a', op: 'notExists' } as Condition, { a: 'x' }, 'false'],
    [
      'a missing key, root supplied',
      { path: 'resource.a', op: 'notExists' } as Condition,
      {},
      'true',
    ],
    [
      'null, root supplied',
      { path: 'resource.a', op: 'notExists' } as Condition,
      { a: null },
      'true',
    ],
    ['an unsupplied root', { path: UNRESOLVED_PATH, op: 'notExists' } as Condition, {}, 'unknown'],
  ] as const)('notExists: %s → %s', (_name, condition, resource, expected) => {
    expect(evaluate(condition, resource)).toBe(expected);
  });
});

describe('combinators', () => {
  const t: Condition = { path: 'resource.a', op: 'eq', value: 'x' };
  const f: Condition = { path: 'resource.a', op: 'eq', value: 'nope' };
  const u: Condition = { path: UNRESOLVED_PATH, op: 'eq', value: 'x' };
  const data = { a: 'x' };

  it.each([
    ['all[true, true]', { all: [t, t] } as Condition, 'true'],
    ['all[true, false]', { all: [t, f] } as Condition, 'false'],
    ['all[true, unknown]', { all: [t, u] } as Condition, 'unknown'],
    [
      'all[false, unknown] — a known counter-example settles it',
      { all: [f, u] } as Condition,
      'false',
    ],
    ['all[unknown, unknown]', { all: [u, u] } as Condition, 'unknown'],
    ['any[false, false]', { any: [f, f] } as Condition, 'false'],
    ['any[true, unknown] — a known witness settles it', { any: [t, u] } as Condition, 'true'],
    ['any[false, unknown]', { any: [f, u] } as Condition, 'unknown'],
    ['not true', { not: t } as Condition, 'false'],
    ['not false', { not: f } as Condition, 'true'],
    ['not unknown stays unknown', { not: u } as Condition, 'unknown'],
    ['nested', { all: [{ any: [f, t] }, { not: f }] } as Condition, 'true'],
    ['nested with an unknown branch', { all: [{ any: [f, u] }, t] } as Condition, 'unknown'],
  ] as const)('%s → %s', (_name, condition, expected) => {
    expect(evaluate(condition, data)).toBe(expected);
  });
});
