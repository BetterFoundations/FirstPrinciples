import { describe, expect, it } from 'vitest';
import { all, any, fromBoolean, negate, type Ternary } from '../../src/internal/truth.js';

/**
 * The Kleene tables directly.
 *
 * The engine's fail-closed property is built out of these three
 * functions, so they are worth pinning independently of the rule
 * evaluation that uses them — particularly `negate('unknown')`, which is
 * the single line stopping `not` from being a way to grant on missing
 * data.
 */

const values: readonly Ternary[] = ['true', 'false', 'unknown'];

describe('fromBoolean', () => {
  it('lifts a definite boolean', () => {
    expect(fromBoolean(true)).toBe('true');
    expect(fromBoolean(false)).toBe('false');
  });
});

describe('negate', () => {
  it.each([
    ['true', 'false'],
    ['false', 'true'],
    ['unknown', 'unknown'],
  ] as const)('negate(%s) = %s', (input, expected) => {
    expect(negate(input)).toBe(expected);
  });

  it('is its own inverse', () => {
    for (const value of values) expect(negate(negate(value))).toBe(value);
  });
});

describe('all', () => {
  it.each([
    [['true', 'true'], 'true'],
    [['true', 'false'], 'false'],
    [['false', 'unknown'], 'false'],
    [['true', 'unknown'], 'unknown'],
    [['unknown', 'unknown'], 'unknown'],
    [['false', 'false'], 'false'],
    [['true'], 'true'],
  ] as const)('all(%j) = %s', (operands, expected) => {
    expect(all([...operands])).toBe(expected);
  });

  it('is order-independent', () => {
    for (const a of values) {
      for (const b of values) {
        expect(all([a, b])).toBe(all([b, a]));
      }
    }
  });
});

describe('any', () => {
  it.each([
    [['false', 'false'], 'false'],
    [['true', 'false'], 'true'],
    [['true', 'unknown'], 'true'],
    [['false', 'unknown'], 'unknown'],
    [['unknown', 'unknown'], 'unknown'],
    [['true'], 'true'],
  ] as const)('any(%j) = %s', (operands, expected) => {
    expect(any([...operands])).toBe(expected);
  });

  it('is order-independent', () => {
    for (const a of values) {
      for (const b of values) {
        expect(any([a, b])).toBe(any([b, a]));
      }
    }
  });
});

describe('De Morgan holds in three values', () => {
  it('not(all(a, b)) === any(not a, not b)', () => {
    for (const a of values) {
      for (const b of values) {
        expect(negate(all([a, b]))).toBe(any([negate(a), negate(b)]));
      }
    }
  });
});

describe('the empty cases, which policy validation makes unreachable', () => {
  it('all([]) is vacuously true and any([]) vacuously false', () => {
    // Recorded rather than relied on: `definePolicy` rejects an empty
    // `all` or `any`, precisely so a policy can never depend on this.
    expect(all([])).toBe('true');
    expect(any([])).toBe('false');
  });
});
