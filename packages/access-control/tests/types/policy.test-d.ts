import { describe, expectTypeOf, it } from 'vitest';
import type { ForbiddenError, Result, ValidationError } from '@firstprinciples/core';
import {
  createAccessControl,
  definePolicy,
  owns,
  parsePolicy,
  PermissionDeniedError,
  type AccessControl,
  type Condition,
  type Decision,
  type PermissionChecker,
  type Policy,
} from '../../src/index.js';
import { createExpressGuard } from '../../src/express.js';

/**
 * Type-level tests. Spec §5 names `access-control` as one of the three
 * packages whose generics warrant them, and the reason is specific: the
 * literal action and subject unions are the *only* place a typo is
 * caught before it becomes a silent runtime denial.
 *
 * The `@ts-expect-error` lines are the assertions. Each one fails the
 * build if the code under it ever starts compiling.
 */

const policy = definePolicy({
  actions: ['read', 'update', 'delete'],
  subjects: ['post', 'comment'],
  roles: { admin: ['author'], author: [] },
  rules: [
    { effect: 'allow', actions: ['read'], subjects: ['post'] },
    {
      effect: 'allow',
      actions: ['update'],
      subjects: ['post'],
      roles: ['author'],
      when: owns('authorId'),
    },
  ],
});

describe('definePolicy infers the declared universe', () => {
  it('narrows actions and subjects to literal unions', () => {
    expectTypeOf(policy).toEqualTypeOf<Policy<'read' | 'update' | 'delete', 'post' | 'comment'>>();
    expectTypeOf(policy.actions).toEqualTypeOf<readonly ('read' | 'update' | 'delete')[]>();
    expectTypeOf(policy.subjects).toEqualTypeOf<readonly ('post' | 'comment')[]>();
  });

  it('infers role names from the keys of the inheritance map', () => {
    // The map form is a mapped type over R rather than Record<R, R[]>,
    // so a role that only ever appears as a key still types.
    definePolicy({
      actions: ['read'],
      subjects: ['post'],
      roles: { admin: ['editor'], editor: ['author'], author: [] },
      rules: [{ effect: 'allow', actions: ['read'], subjects: ['post'], roles: ['admin'] }],
    });
  });
});

describe('a typo inside a rule does not widen the universe', () => {
  it('rejects an undeclared action in a rule', () => {
    definePolicy({
      actions: ['read'],
      subjects: ['post'],
      // @ts-expect-error 'reed' is not a declared action
      rules: [{ effect: 'allow', actions: ['reed'], subjects: ['post'] }],
    });
  });

  it('rejects an undeclared subject in a rule', () => {
    definePolicy({
      actions: ['read'],
      subjects: ['post'],
      // @ts-expect-error 'pots' is not a declared subject
      rules: [{ effect: 'allow', actions: ['read'], subjects: ['pots'] }],
    });
  });

  it('rejects an undeclared role in a rule', () => {
    definePolicy({
      actions: ['read'],
      subjects: ['post'],
      roles: ['author'],
      // @ts-expect-error 'admin' is not a declared role
      rules: [{ effect: 'allow', actions: ['read'], subjects: ['post'], roles: ['admin'] }],
    });
  });

  it('rejects an effect that is neither allow nor deny', () => {
    definePolicy({
      actions: ['read'],
      subjects: ['post'],
      // @ts-expect-error 'permit' is not an effect
      rules: [{ effect: 'permit', actions: ['read'], subjects: ['post'] }],
    });
  });
});

describe('can() is constrained to the declared universe', () => {
  const permissions = createAccessControl(policy).for({ id: 'u1' });

  it('accepts declared names', () => {
    expectTypeOf(permissions.can).parameter(0).toEqualTypeOf<'read' | 'update' | 'delete'>();
    expectTypeOf(permissions.can).parameter(1).toEqualTypeOf<'post' | 'comment'>();
    expectTypeOf(permissions.can('read', 'post')).toEqualTypeOf<boolean>();
    expectTypeOf(permissions.explain('read', 'post')).toEqualTypeOf<Decision>();
    expectTypeOf(permissions.assertCan('read', 'post')).toEqualTypeOf<void>();
  });

  it('rejects an action the policy never declared', () => {
    // @ts-expect-error 'frobnicate' is not a declared action
    permissions.can('frobnicate', 'post');
  });

  it('rejects a subject the policy never declared', () => {
    // @ts-expect-error 'wizzbang' is not a declared subject
    permissions.can('read', 'wizzbang');
  });

  it('rejects a resource that is not an object', () => {
    // @ts-expect-error a resource is attributes, not a primitive
    permissions.can('read', 'post', { resource: 'p1' });
  });
});

describe('widening is available for actions that arrive as data', () => {
  it('a typed AccessControl is assignable to the widened one', () => {
    const widened: AccessControl = createAccessControl(policy);
    expectTypeOf(widened.for(null)).toEqualTypeOf<PermissionChecker<string, string>>();
    // Safe by construction: an undeclared action is denied before any
    // rule is consulted.
    expectTypeOf(widened.for(null).can('anything', 'at-all')).toEqualTypeOf<boolean>();
  });
});

describe('parsePolicy', () => {
  it('returns a Result rather than throwing', () => {
    expectTypeOf(parsePolicy({})).toEqualTypeOf<Result<Policy, ValidationError>>();
  });

  it('loses the literal unions, because runtime values cannot carry them', () => {
    const parsed = parsePolicy({});
    if (parsed.ok) expectTypeOf(parsed.value).toEqualTypeOf<Policy<string, string>>();
  });
});

describe('guards inherit the same constraint', () => {
  const requirePermission = createExpressGuard(createAccessControl(policy), {
    getPrincipal: () => null,
  });

  it('accepts declared names', () => {
    requirePermission('delete', 'post');
  });

  it('rejects an undeclared action in a route definition', () => {
    // @ts-expect-error 'archive' is not a declared action
    requirePermission('archive', 'post');
  });
});

describe('conditions and errors', () => {
  it('owns() produces ordinary policy data', () => {
    expectTypeOf(owns('authorId')).toMatchTypeOf<Condition>();
  });

  it('PermissionDeniedError is a ForbiddenError', () => {
    const error = new PermissionDeniedError({
      allowed: false,
      reason: 'no_matching_rule',
      action: 'read',
      subject: 'post',
    });
    expectTypeOf(error).toMatchTypeOf<ForbiddenError>();
    expectTypeOf(error.kind).toEqualTypeOf<'ForbiddenError'>();
    expectTypeOf(error.reason).toEqualTypeOf<Decision['reason']>();
  });
});
