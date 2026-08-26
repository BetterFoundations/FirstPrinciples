import { afterEach, describe, expect, it } from 'vitest';
import {
  createAccessControl,
  definePolicy,
  isPolicy,
  owns,
  parsePolicy,
  type Policy,
} from '../../src/index.js';

/**
 * Prototype pollution against the *structure* of a decision.
 *
 * `fail-closed.test.ts` already covers the half of this that is about
 * data: a polluted `Object.prototype.ownerId` must not supply a resource
 * its owner. This file covers the other half, which is the more
 * dangerous one — the engine reads its own shapes off plain object
 * literals too. A rule's `roles`, a rule's `when`, a condition's
 * `all`/`any`/`not`/`ref`/`value`, a context's `resource` and `env` are
 * all *omitted* rather than set to `undefined` when unused, so reading
 * one with `in` or a bare property access consults `Object.prototype`.
 *
 * One polluted key therefore does not rewrite one rule. It rewrites
 * every rule in the policy at once, and the direction that matters is
 * always the same: a `deny` that applied to everybody quietly applying
 * to nobody, or a conditional `allow` quietly becoming unconditional.
 *
 * Every test below asserts the answer is still "no", and each one
 * granted before the own-property reads went in.
 */

const proto = Object.prototype as unknown as Record<string, unknown>;

const POLLUTABLE = [
  'all',
  'any',
  'not',
  'ref',
  'path',
  'op',
  'roles',
  'when',
  'id',
  'resource',
  'env',
  'effect',
  'actions',
  'subjects',
] as const;

afterEach(() => {
  // A delete keyed by this file's own literal list, on Object.prototype
  // itself — the whole point of the suite is to put things there and
  // take them off again.
  // eslint-disable-next-line security/detect-object-injection
  for (const key of POLLUTABLE) delete proto[key];
});

/** An `allow` gated on ownership, and nothing else. Nothing may grant without a real owner match. */
const ownershipPolicy = definePolicy({
  actions: ['update'],
  subjects: ['post'],
  roles: ['author'],
  rules: [
    {
      id: 'author-edits-own',
      effect: 'allow',
      actions: ['update'],
      subjects: ['post'],
      roles: ['author'],
      when: owns('authorId'),
    },
  ],
});
const ownership = createAccessControl(ownershipPolicy);
const author = { id: 'u1', roles: ['author'] };
const someoneElsesPost = { authorId: 'u2' };

/** A broad `allow` fenced in by a `deny` that applies to every caller. */
const fencedPolicy = definePolicy({
  actions: ['update'],
  subjects: ['post'],
  roles: ['author'],
  rules: [
    {
      id: 'authors-update',
      effect: 'allow',
      actions: ['update'],
      subjects: ['post'],
      roles: ['author'],
    },
    {
      id: 'locked-posts-are-frozen',
      effect: 'deny',
      actions: ['update'],
      subjects: ['post'],
      when: { path: 'resource.locked', op: 'eq', value: true },
    },
  ],
});
const fenced = createAccessControl(fencedPolicy);
const lockedPost = { locked: true };

describe('a polluted combinator key cannot make a condition true', () => {
  it('`Object.prototype.all = []` does not turn an ownership `allow` unconditional', () => {
    // `all([])` is vacuously true, so a condition that merely *looked*
    // like a conjunction would have granted update on someone else's post.
    proto['all'] = [];
    expect(ownership.for(author).can('update', 'post', { resource: someoneElsesPost })).toBe(false);
  });

  it('`Object.prototype.any = []` does not silence a `deny`', () => {
    // `any([])` is vacuously false, which is the mirror image: the
    // deny's condition reads as a disjunction of nothing and stops firing.
    proto['any'] = [];
    expect(fenced.for(author).can('update', 'post', { resource: lockedPost })).toBe(false);
  });

  it('`Object.prototype.not` does not recurse until the stack overflows', () => {
    // Every condition now contains itself. Unbounded recursion would
    // throw a RangeError straight out of `can()`.
    proto['not'] = { path: 'resource.locked', op: 'eq', value: true };
    expect(() => fenced.for(author).can('update', 'post', { resource: lockedPost })).not.toThrow();
    expect(fenced.for(author).can('update', 'post', { resource: lockedPost })).toBe(false);
  });

  it('a combinator key of the wrong type does not throw out of `can()`', () => {
    // `condition.all.map(...)` on a number is a TypeError, and `can()`
    // is documented never to throw — a check that can throw is a check
    // someone wraps in a `catch` that gets written as "allow".
    proto['all'] = 5;
    expect(() =>
      ownership.for(author).can('update', 'post', { resource: someoneElsesPost }),
    ).not.toThrow();
    expect(ownership.for(author).can('update', 'post', { resource: someoneElsesPost })).toBe(false);
  });
});

describe('a polluted operand key cannot re-point a comparison', () => {
  it('`Object.prototype.ref` does not hijack a literal comparison and silence a `deny`', () => {
    // The deny compares `resource.locked` to the literal `true`. Read
    // via `in`, an inherited `ref` wins over the rule's own `value`, so
    // the comparison becomes `resource.locked` vs `principal.id` —
    // false — and the locked post becomes editable.
    proto['ref'] = 'principal.id';
    expect(fenced.for(author).can('update', 'post', { resource: lockedPost })).toBe(false);
  });

  // `value` is deliberately not exercised here: `ref` is consulted
  // first, so it is the operand key that can actually override a rule's
  // own right-hand side, and polluting `value` breaks
  // `Object.defineProperty` for the whole runtime — every property
  // descriptor inherits it — long before it reaches this engine.

  it('a condition whose own `path` and `op` are intact still decides normally', () => {
    proto['path'] = 'principal.id';
    proto['op'] = 'exists';
    expect(ownership.for(author).can('update', 'post', { resource: { authorId: 'u1' } })).toBe(
      true,
    );
    expect(fenced.for(author).can('update', 'post', { resource: lockedPost })).toBe(false);
  });
});

describe('a polluted rule key cannot re-target a rule', () => {
  it('`Object.prototype.roles` does not narrow a `deny` that applied to everyone', () => {
    // `locked-posts-are-frozen` declares no roles, which means every
    // caller. An inherited `roles` naming a role nobody holds re-targets
    // it at nobody, and the broad allow behind it is then unopposed.
    proto['roles'] = ['nobody-holds-this'];
    expect(fenced.for(author).can('update', 'post', { resource: lockedPost })).toBe(false);
  });

  it('`Object.prototype.when` cannot attach a condition to an unconditional rule', () => {
    // Not a grant on its own — an inherited `when` reaches every
    // unconditional rule at once, so whatever it evaluates to, the
    // `deny` and the `allow` move together and the outcome stays a
    // denial. It is fixed anyway, because "harmless as long as both
    // sides are polluted identically" is not a property worth resting a
    // permission engine on, and it is one refactor away from not
    // holding.
    const suspension = createAccessControl(
      definePolicy({
        actions: ['update'],
        subjects: ['post'],
        roles: ['author'],
        rules: [
          { effect: 'allow', actions: ['update'], subjects: ['post'], roles: ['author'] },
          {
            id: 'suspended-accounts',
            effect: 'deny',
            actions: ['update'],
            subjects: ['post'],
            roles: ['author'],
          },
        ],
      }),
    );
    expect(suspension.for(author).can('update', 'post', {})).toBe(false);
    proto['when'] = { path: 'principal.id', op: 'notExists' };
    const decision = suspension.for(author).explain('update', 'post', {});
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('explicit_deny');
    expect(decision.ruleId).toBe('suspended-accounts');
  });

  it('`Object.prototype.id` is not reported as the rule that decided', () => {
    // `explain().ruleId` is what a denial gets logged under. A rule
    // written without an id must stay without one, or every audit trail
    // in the process starts naming a rule that does not exist.
    const anonymousRule = createAccessControl(
      definePolicy({
        actions: ['update'],
        subjects: ['post'],
        roles: ['author'],
        rules: [{ effect: 'allow', actions: ['update'], subjects: ['post'], roles: ['author'] }],
      }),
    );
    proto['id'] = 'HIJACKED';
    const decision = anonymousRule.for(author).explain('update', 'post', {});
    expect(decision.allowed).toBe(true);
    expect(decision.ruleId).toBeUndefined();
  });

  // `actions` and `subjects` are mandatory, so a validated rule always
  // carries its own and nothing can be inherited in their place. Pinned
  // anyway, because that is a property of the normalizer rather than of
  // the engine, and the engine should not start depending on it.
  it('`Object.prototype.actions`/`subjects` do not widen what a rule covers', () => {
    proto['actions'] = '*';
    proto['subjects'] = '*';
    expect(ownership.for(author).can('update', 'post', { resource: someoneElsesPost })).toBe(false);
  });
});

describe('a polluted context key cannot supply attributes the caller never passed', () => {
  it('`Object.prototype.resource` does not answer an ownership check', () => {
    proto['resource'] = { authorId: 'u1' };
    // A type-level question — no resource in hand — must stay a denial.
    expect(ownership.for(author).can('update', 'post', {})).toBe(false);
    expect(ownership.for(author).can('update', 'post')).toBe(false);
  });

  it('`Object.prototype.env` does not answer a check on ambient attributes', () => {
    const envPolicy = definePolicy({
      actions: ['deploy'],
      subjects: ['service'],
      rules: [
        {
          effect: 'allow',
          actions: ['deploy'],
          subjects: ['service'],
          when: { path: 'env.window', op: 'eq', value: 'open' },
        },
      ],
    });
    proto['env'] = { window: 'open' };
    expect(createAccessControl(envPolicy).for(author).can('deploy', 'service', {})).toBe(false);
  });
});

describe('a polluted brand cannot pass an unvalidated policy off as a validated one', () => {
  it('isPolicy demands the brand as an own property', () => {
    proto[Symbol.for('@firstprinciples/access-control/Policy') as unknown as string] = true;
    expect(isPolicy({})).toBe(false);
    expect(isPolicy(JSON.parse(JSON.stringify(ownershipPolicy)))).toBe(false);
    expect(isPolicy(ownershipPolicy)).toBe(true);
    delete proto[Symbol.for('@firstprinciples/access-control/Policy') as unknown as string];
  });

  it('createAccessControl still refuses the wire copy', () => {
    proto[Symbol.for('@firstprinciples/access-control/Policy') as unknown as string] = true;
    expect(() => createAccessControl({ actions: [], subjects: [], roles: {}, rules: [] })).toThrow(
      /UNVALIDATED_POLICY|definePolicy/,
    );
    delete proto[Symbol.for('@firstprinciples/access-control/Policy') as unknown as string];
  });
});

describe('a forged condition that never went through validation still cannot grant', () => {
  /** Bypasses `parsePolicy` the way a hand-built policy object would. */
  function forgeRule(rule: Record<string, unknown>): Policy {
    const parsed = parsePolicy({
      actions: ['update'],
      subjects: ['post'],
      rules: [
        {
          effect: 'allow',
          actions: ['update'],
          subjects: ['post'],
          when: { path: 'resource.locked', op: 'eq', value: true },
        },
      ],
    });
    if (!('value' in parsed)) throw new Error('fixture policy must validate');
    const policy = parsed.value;
    // The rules are frozen, so rebuild the array around a forged rule
    // and re-brand it — exactly the shape a caller who reached past the
    // public API would produce.
    const forged = { ...policy, rules: [rule] };
    Object.defineProperty(forged, Symbol.for('@firstprinciples/access-control/Policy'), {
      value: true,
      enumerable: false,
    });
    return forged as unknown as Policy;
  }

  /** The common case: a well-formed `allow` carrying a forged condition. */
  function forge(when: unknown): Policy {
    return forgeRule({ effect: 'allow', actions: ['update'], subjects: ['post'], when });
  }

  it('a rule whose `actions` selector is neither an array nor `*` matches nothing', () => {
    // `'update'.includes('update')` is true, so a bare string selector
    // would quietly behave like a wildcard over every action whose name
    // is a substring of it.
    const forged = forgeRule({ effect: 'allow', actions: 'update', subjects: ['post'] });
    expect(createAccessControl(forged).for(author).can('update', 'post', {})).toBe(false);
  });

  it('a rule whose `roles` selector is not an array matches nobody', () => {
    const forged = forgeRule({
      effect: 'allow',
      actions: ['update'],
      subjects: ['post'],
      roles: 'author',
    });
    expect(createAccessControl(forged).for(author).can('update', 'post', {})).toBe(false);
  });

  it('an explicit `when: undefined` is an unconditional rule, not an unevaluable one', () => {
    const forged = forgeRule({
      effect: 'allow',
      actions: ['update'],
      subjects: ['post'],
      when: undefined,
    });
    expect(createAccessControl(forged).for(author).can('update', 'post', {})).toBe(true);
  });

  it('a `ref` that is not a path string is unknown', () => {
    expect(
      createAccessControl(
        forge({ path: 'principal.id', op: 'eq', ref: { toString: () => 'principal.id' } }),
      )
        .for(author)
        .can('update', 'post', {}),
    ).toBe(false);
  });

  it('a binary operator with neither `value` nor `ref` is unknown', () => {
    expect(
      createAccessControl(forge({ path: 'principal.id', op: 'eq' }))
        .for(author)
        .can('update', 'post', {}),
    ).toBe(false);
  });

  it('an empty `all` is unknown rather than vacuously true', () => {
    expect(
      createAccessControl(forge({ all: [] }))
        .for(author)
        .can('update', 'post', {}),
    ).toBe(false);
  });

  it('an empty `any` is unknown rather than vacuously false', () => {
    expect(
      createAccessControl(forge({ any: [] }))
        .for(author)
        .can('update', 'post', {}),
    ).toBe(false);
  });

  it('a self-referential condition terminates instead of overflowing the stack', () => {
    const cycle: Record<string, unknown> = {};
    cycle['not'] = cycle;
    const checker = createAccessControl(forge(cycle)).for(author);
    expect(() => checker.can('update', 'post', {})).not.toThrow();
    expect(checker.can('update', 'post', {})).toBe(false);
  });

  it('a condition nested past the evaluator’s depth limit is unknown, not true', () => {
    let deep: unknown = { path: 'principal.id', op: 'exists' };
    for (let i = 0; i < 64; i += 1) deep = { all: [deep] };
    expect(createAccessControl(forge(deep)).for(author).can('update', 'post', {})).toBe(false);
  });

  it('a condition that is not an object at all is unknown', () => {
    for (const when of [null, 'yes', 42, true, []]) {
      expect(createAccessControl(forge(when)).for(author).can('update', 'post', {})).toBe(false);
    }
  });

  it('a rule whose `when` throws on evaluation denies rather than escaping', () => {
    const hostile = {
      get all(): never {
        throw new Error('hostile condition');
      },
    };
    const checker = createAccessControl(forge(hostile)).for(author);
    expect(() => checker.can('update', 'post', {})).not.toThrow();
    expect(checker.can('update', 'post', {})).toBe(false);
  });
});

describe('binding a principal never throws', () => {
  it('a claimed-roles array with a throwing accessor yields no roles', () => {
    const roles: string[] = ['author'];
    Object.defineProperty(roles, 0, {
      get(): never {
        throw new Error('hostile roles');
      },
      configurable: true,
    });
    expect(() => ownership.for({ id: 'u1', roles })).not.toThrow();
    expect([...ownership.for({ id: 'u1', roles }).roles]).toEqual([]);
    expect(
      ownership.for({ id: 'u1', roles }).can('update', 'post', { resource: { authorId: 'u1' } }),
    ).toBe(false);
  });
});

describe('role names are validated the same way in both declaration forms', () => {
  it('rejects a prototype-walking role name in the list form, as the map form already did', () => {
    const asList = parsePolicy({
      actions: ['read'],
      subjects: ['post'],
      roles: ['__proto__', 'constructor', 'prototype'],
      rules: [],
    });
    const asMap = parsePolicy({
      actions: ['read'],
      subjects: ['post'],
      roles: { __proto__: [], constructor: [], prototype: [] },
      rules: [],
    });
    for (const outcome of [asList, asMap]) {
      expect('error' in outcome).toBe(true);
      if ('error' in outcome) {
        expect(outcome.error.message).toMatch(/not usable as a role name/);
      }
    }
  });

  it('still accepts an ordinary role name in the list form', () => {
    const outcome = parsePolicy({
      actions: ['read'],
      subjects: ['post'],
      roles: ['admin'],
      rules: [],
    });
    expect('value' in outcome).toBe(true);
  });
});
