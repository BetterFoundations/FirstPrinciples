import { describe, expect, it } from 'vitest';
import { resolvePath, type AttributeEnvironment } from '../../src/internal/resolve.js';

/**
 * Path resolution — the only place attacker-shaped data is walked.
 *
 * The `absent` / `unresolved` distinction is the point of most of these:
 * `absent` is a fact about a root that was supplied, `unresolved` is the
 * absence of facts, and only the second makes `exists` answer `unknown`.
 */

const environment: AttributeEnvironment = {
  principal: { id: 'u1', profile: { tier: 'gold' }, tags: ['a', 'b'] },
  resource: { ownerId: 'u1', nested: { deep: { value: 42 } } },
  env: undefined,
};

describe('resolving a value', () => {
  it.each([
    ['principal.id', 'u1'],
    ['principal.profile.tier', 'gold'],
    ['resource.ownerId', 'u1'],
    ['resource.nested.deep.value', 42],
    ['principal.tags.0', 'a'],
    ['principal.tags.length', 2],
  ])('%s → %s', (path, expected) => {
    expect(resolvePath(environment, path)).toEqual({ kind: 'value', value: expected });
  });
});

describe('absent: the root was supplied, the attribute is not there', () => {
  it.each([
    ['a missing key', 'resource.missing'],
    ['a missing key under a present one', 'resource.nested.missing'],
    ['a key under a primitive', 'principal.id.length'],
    ['an out-of-range index', 'principal.tags.9'],
    ['a segment beyond a missing intermediate', 'resource.missing.deeper.still'],
  ])('%s', (_name, path) => {
    expect(resolvePath(environment, path)).toEqual({ kind: 'absent' });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('a value of %s counts as absent', (_name, value) => {
    expect(resolvePath({ ...environment, resource: { a: value } }, 'resource.a')).toEqual({
      kind: 'absent',
    });
  });
});

describe('unresolved: there is nothing to look in', () => {
  it.each([
    ['a root that was never supplied', 'env.anything', environment],
    ['a root supplied as null', 'resource.a', { ...environment, resource: null }],
    ['a root supplied as a string', 'resource.a', { ...environment, resource: 'nope' }],
    ['a root supplied as a number', 'resource.a', { ...environment, resource: 7 }],
    ['an unrecognized root', 'session.a', environment],
    ['a bare root with no attribute', 'resource', environment],
    ['an empty path', '', environment],
  ])('%s', (_name, path, env) => {
    expect(resolvePath(env as AttributeEnvironment, path)).toEqual({ kind: 'unresolved' });
  });

  it('a throwing getter is unresolved, not absent', () => {
    // If this were `absent`, `exists` would answer a definite `false` and
    // a `deny … when x exists` would be skipped. See fail-closed.test.ts.
    const hostile = {};
    Object.defineProperty(hostile, 'boom', {
      enumerable: true,
      get() {
        throw new Error('nope');
      },
    });
    expect(resolvePath({ ...environment, resource: hostile }, 'resource.boom')).toEqual({
      kind: 'unresolved',
    });
  });
});

describe('only own properties are walked', () => {
  it('does not read an inherited property', () => {
    const parent = { inherited: 'yes' };
    const child = Object.create(parent) as object;
    expect(resolvePath({ ...environment, resource: child }, 'resource.inherited')).toEqual({
      kind: 'absent',
    });
  });

  it('does not read a prototype accessor on a class instance', () => {
    class Doc {
      constructor(readonly ownerId: string) {}
      get computedOwner(): string {
        return this.ownerId;
      }
    }
    const doc = new Doc('u1');
    expect(resolvePath({ ...environment, resource: doc }, 'resource.ownerId')).toEqual({
      kind: 'value',
      value: 'u1',
    });
    // The accessor lives on the prototype, so it is invisible. Policies
    // are evaluated against plain data by design.
    expect(resolvePath({ ...environment, resource: doc }, 'resource.computedOwner')).toEqual({
      kind: 'absent',
    });
  });

  it('does not reach anything on Object.prototype', () => {
    for (const path of ['resource.toString', 'resource.hasOwnProperty', 'resource.valueOf']) {
      expect(resolvePath(environment, path)).toEqual({ kind: 'absent' });
    }
  });

  it('reads a null-prototype object normally', () => {
    const bare = Object.assign(Object.create(null) as object, { a: 1 });
    expect(resolvePath({ ...environment, resource: bare }, 'resource.a')).toEqual({
      kind: 'value',
      value: 1,
    });
  });
});
