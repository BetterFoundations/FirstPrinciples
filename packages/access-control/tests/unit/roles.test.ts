import { describe, expect, it } from 'vitest';
import { buildRoleClosures, resolveEffectiveRoles } from '../../src/internal/roles.js';

describe('role closures', () => {
  it('includes the role itself', () => {
    const closures = buildRoleClosures({ writer: [] });
    expect([...(closures.get('writer') ?? [])]).toEqual(['writer']);
  });

  it('is transitive', () => {
    const closures = buildRoleClosures({ admin: ['editor'], editor: ['author'], author: [] });
    expect([...(closures.get('admin') ?? [])].sort()).toEqual(['admin', 'author', 'editor']);
  });

  it('terminates on a cycle, treating the ring as equivalent roles', () => {
    // Not rejected at definition time: a cycle is a modelling oddity, not
    // a security problem, and the visited set is what guarantees this
    // returns at all.
    const closures = buildRoleClosures({ a: ['b'], b: ['c'], c: ['a'] });
    expect([...(closures.get('a') ?? [])].sort()).toEqual(['a', 'b', 'c']);
    expect([...(closures.get('b') ?? [])].sort()).toEqual(['a', 'b', 'c']);
  });

  it('terminates on a self-reference', () => {
    const closures = buildRoleClosures({ a: ['a'] });
    expect([...(closures.get('a') ?? [])]).toEqual(['a']);
  });

  it('treats a reference to an undeclared role as a leaf rather than throwing', () => {
    const closures = buildRoleClosures({ a: ['ghost'] });
    expect([...(closures.get('a') ?? [])].sort()).toEqual(['a', 'ghost']);
  });
});

describe('effective roles', () => {
  const closures = buildRoleClosures({ admin: ['writer'], writer: [] });

  it('unions the closures of every claimed role', () => {
    const effective = resolveEffectiveRoles(closures, ['admin']);
    expect([...effective.roles].sort()).toEqual(['admin', 'writer']);
    expect(effective.unknown).toEqual([]);
  });

  it('collects undeclared roles instead of matching them', () => {
    const effective = resolveEffectiveRoles(closures, ['Admin', 'writer']);
    expect([...effective.roles]).toEqual(['writer']);
    expect(effective.unknown).toEqual(['Admin']);
  });

  it('de-duplicates the undeclared ones', () => {
    expect(resolveEffectiveRoles(closures, ['x', 'x', 'x']).unknown).toEqual(['x']);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a bare string', 'admin'],
    ['an object', { admin: true }],
    ['a number', 7],
  ])('holds no roles when `roles` is %s', (_name, claimed) => {
    const effective = resolveEffectiveRoles(closures, claimed);
    expect(effective.roles.size).toBe(0);
    expect(effective.unknown).toEqual([]);
  });

  it('skips non-string entries inside the array', () => {
    const effective = resolveEffectiveRoles(closures, ['writer', 7, null, { a: 1 }]);
    expect([...effective.roles]).toEqual(['writer']);
    expect(effective.unknown).toEqual([]);
  });
});
