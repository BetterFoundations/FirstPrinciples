import { afterEach, describe, expect, it } from 'vitest';
import { createAccessControl, definePolicy, owns, type Principal } from '../../src/index.js';

/**
 * Fail-closed behaviour, enumerated rather than sampled.
 *
 * Every test here asks the engine a question it does not have the
 * information to answer, and requires the answer to be "no". The
 * interesting direction is the one nobody writes a test for: a check
 * that grants because two absent values compared equal, or because a
 * `deny` could not be evaluated and was skipped.
 */

const ownershipPolicy = definePolicy({
  actions: ['edit'],
  subjects: ['doc'],
  roles: ['writer'],
  rules: [
    {
      id: 'writer-edits-own',
      effect: 'allow',
      actions: ['edit'],
      subjects: ['doc'],
      roles: ['writer'],
      when: owns('ownerId'),
    },
  ],
});

const ownership = createAccessControl(ownershipPolicy);

describe('ownership: the full principal × resource matrix', () => {
  /**
   * A sentinel for "this side resolves to no value at all". Anything
   * else is a real value the engine may legitimately compare.
   */
  const ABSENT = Symbol('absent');

  /** Every way a principal can fail to have a usable id, plus two ways it can. */
  const principals: readonly (readonly [string, Principal | null, string | symbol])[] = [
    ['anonymous', null, ABSENT],
    ['no id field', { roles: ['writer'] }, ABSENT],
    ['id: undefined', { id: undefined, roles: ['writer'] }, ABSENT],
    ['id: null', { id: null, roles: ['writer'] } as unknown as Principal, ABSENT],
    ['id: empty string', { id: '', roles: ['writer'] }, ''],
    ['id: matching', { id: 'u1', roles: ['writer'] }, 'u1'],
    ['id: different', { id: 'u2', roles: ['writer'] }, 'u2'],
  ];

  /** Every way a resource can fail to name an owner, plus two ways it can. */
  const resources: readonly (readonly [string, object | null | undefined, string | symbol])[] = [
    ['no context at all', undefined, ABSENT],
    ['resource: null', null, ABSENT],
    ['resource: {}', {}, ABSENT],
    ['ownerId: undefined', { ownerId: undefined }, ABSENT],
    ['ownerId: null', { ownerId: null }, ABSENT],
    ['ownerId: empty string', { ownerId: '' }, ''],
    ['ownerId: matching', { ownerId: 'u1' }, 'u1'],
    ['ownerId: different', { ownerId: 'u9' }, 'u9'],
  ];

  for (const [principalName, principal, principalId] of principals) {
    for (const [resourceName, resource, ownerId] of resources) {
      // A grant needs a real value on *both* sides, and they must be
      // equal. Note that `''` counts as a real value: it is falsy, not
      // absent, and conflating the two is its own class of bug. Every
      // other cell in this 7×8 matrix must deny.
      const shouldAllow = principalId !== ABSENT && principalId === ownerId;
      it(`${principalName} + ${resourceName} → ${shouldAllow ? 'allow' : 'deny'}`, () => {
        expect(ownership.for(principal).can('edit', 'doc', { resource })).toBe(shouldAllow);
      });
    }
  }

  it('grants on exactly two of the fifty-six cells', () => {
    const granted = principals.flatMap(([, principal, principalId]) =>
      resources
        .filter(([, resource]) => ownership.for(principal).can('edit', 'doc', { resource }))
        .map(([resourceName]) => `${String(principalId)}/${resourceName}`),
    );
    expect(granted).toEqual(['/ownerId: empty string', 'u1/ownerId: matching']);
  });

  it('a numeric id never matches its string spelling', () => {
    expect(
      ownership
        .for({ id: 1 as unknown as string, roles: ['writer'] })
        .can('edit', 'doc', { resource: { ownerId: '1' } }),
    ).toBe(false);
  });
});

describe('unevaluable conditions never grant', () => {
  const policy = definePolicy({
    actions: ['act'],
    subjects: ['thing'],
    rules: [
      {
        id: 'allow-if',
        effect: 'allow',
        actions: ['act'],
        subjects: ['thing'],
        when: { path: 'env.ok', op: 'eq', value: true },
      },
      {
        id: 'allow-if-not',
        effect: 'allow',
        actions: ['act'],
        subjects: ['thing'],
        when: { not: { path: 'resource.blocked', op: 'eq', value: true } },
      },
      {
        id: 'allow-if-exists',
        effect: 'allow',
        actions: ['act'],
        subjects: ['thing'],
        when: { path: 'resource.token', op: 'exists' },
      },
      {
        id: 'allow-if-any',
        effect: 'allow',
        actions: ['act'],
        subjects: ['thing'],
        when: {
          any: [
            { path: 'env.a', op: 'eq', value: 1 },
            { path: 'env.b', op: 'eq', value: 2 },
          ],
        },
      },
    ],
  });
  const ac = createAccessControl(policy);

  it('a `not` over a missing attribute does not become true', () => {
    // The dangerous case: boolean negation would turn "I was not given a
    // resource" into "the resource is not blocked".
    expect(ac.for(null).can('act', 'thing')).toBe(false);
  });

  it('`exists` over a root that was never supplied is unknown, not false-then-true', () => {
    expect(ac.for(null).can('act', 'thing', { resource: null })).toBe(false);
  });

  it('an `any` where every branch is unknown does not grant', () => {
    expect(ac.for(null).can('act', 'thing', { env: {} })).toBe(false);
  });

  it('the same policy does grant once the attribute is actually there', () => {
    expect(ac.for(null).can('act', 'thing', { env: { ok: true } })).toBe(true);
    expect(ac.for(null).can('act', 'thing', { resource: { blocked: false } })).toBe(true);
    expect(ac.for(null).can('act', 'thing', { resource: { token: 'x' } })).toBe(true);
    expect(ac.for(null).can('act', 'thing', { env: { b: 2 } })).toBe(true);
  });
});

describe('unevaluable conditions always deny', () => {
  const policy = definePolicy({
    actions: ['act'],
    subjects: ['thing'],
    rules: [
      { id: 'open', effect: 'allow', actions: '*', subjects: '*' },
      {
        id: 'deny-if-classified',
        effect: 'deny',
        actions: ['act'],
        subjects: ['thing'],
        when: { path: 'resource.classified', op: 'eq', value: true },
      },
    ],
  });
  const ac = createAccessControl(policy);

  it('denies when the deny cannot be ruled out', () => {
    const decision = ac.for(null).explain('act', 'thing');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('unresolved_deny');
  });

  it('allows once the deny can be ruled out', () => {
    expect(ac.for(null).can('act', 'thing', { resource: { classified: false } })).toBe(true);
  });

  it('a deny whose `exists` check hits a throwing getter still fires', () => {
    const hostile = {};
    Object.defineProperty(hostile, 'classified', {
      enumerable: true,
      get() {
        throw new Error('nope');
      },
    });
    // A throwing getter is `unresolved`, not `absent` — if it were
    // `absent`, `exists` would answer a definite `false` and the deny
    // would be skipped.
    const existsPolicy = definePolicy({
      actions: ['act'],
      subjects: ['thing'],
      rules: [
        { id: 'open', effect: 'allow', actions: '*', subjects: '*' },
        {
          id: 'deny-if-set',
          effect: 'deny',
          actions: ['act'],
          subjects: ['thing'],
          when: { path: 'resource.classified', op: 'exists' },
        },
      ],
    });
    const decision = createAccessControl(existsPolicy)
      .for(null)
      .explain('act', 'thing', { resource: hostile });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('unresolved_deny');
  });
});

describe('malformed input is denied, never thrown on', () => {
  const ac = createAccessControl(ownershipPolicy);
  const writer: Principal = { id: 'u1', roles: ['writer'] };

  it.each([
    ['a string resource', 'u1'],
    ['a number resource', 42],
    ['an array resource', ['u1']],
    ['a function resource', () => 'u1'],
  ])('%s denies without throwing', (_name, resource) => {
    expect(() =>
      ac.for(writer).can('edit', 'doc', { resource: resource as unknown as object }),
    ).not.toThrow();
    expect(ac.for(writer).can('edit', 'doc', { resource: resource as unknown as object })).toBe(
      false,
    );
  });

  it('a principal that is not an object denies without throwing', () => {
    expect(
      ac.for('u1' as unknown as Principal).can('edit', 'doc', { resource: { ownerId: 'u1' } }),
    ).toBe(false);
  });

  it('a principal whose roles are not an array holds no roles', () => {
    const odd = { id: 'u1', roles: 'writer' } as unknown as Principal;
    expect(ac.for(odd).roles.size).toBe(0);
    expect(ac.for(odd).can('edit', 'doc', { resource: { ownerId: 'u1' } })).toBe(false);
  });

  it('a resource with a throwing getter denies without throwing', () => {
    const hostile = {};
    Object.defineProperty(hostile, 'ownerId', {
      enumerable: true,
      get() {
        throw new Error('nope');
      },
    });
    expect(ac.for(writer).can('edit', 'doc', { resource: hostile })).toBe(false);
  });

  it('a null-prototype resource is read normally', () => {
    const bare = Object.assign(Object.create(null) as object, { ownerId: 'u1' });
    expect(ac.for(writer).can('edit', 'doc', { resource: bare })).toBe(true);
  });
});

describe('prototype pollution cannot manufacture an attribute', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>)['ownerId'];
    delete (Object.prototype as Record<string, unknown>)['id'];
  });

  it('a polluted Object.prototype does not supply a missing owner', () => {
    (Object.prototype as Record<string, unknown>)['ownerId'] = 'u1';
    // Path walking reads own properties only, so the inherited value is
    // invisible and the resource still has no owner.
    expect(
      ownership.for({ id: 'u1', roles: ['writer'] }).can('edit', 'doc', { resource: {} }),
    ).toBe(false);
  });

  it('a polluted Object.prototype does not supply a missing principal id', () => {
    (Object.prototype as Record<string, unknown>)['id'] = 'u1';
    expect(
      ownership.for({ roles: ['writer'] }).can('edit', 'doc', { resource: { ownerId: 'u1' } }),
    ).toBe(false);
  });

  it('a policy naming a prototype-walking path is rejected outright', () => {
    expect(() =>
      definePolicy({
        actions: ['edit'],
        subjects: ['doc'],
        rules: [
          {
            effect: 'allow',
            actions: ['edit'],
            subjects: ['doc'],
            when: { path: 'principal.__proto__.isAdmin', op: 'eq', value: true },
          },
        ],
      }),
    ).toThrow(/not a walkable segment/);
  });
});
