import { describe, expect, it } from 'vitest';
import {
  createAccessControl,
  definePolicy,
  owns,
  PermissionDeniedError,
  type AccessControl,
  type Principal,
} from '../../src/index.js';
import { sharedPolicy } from '../shared/policy.js';

const policy = definePolicy({
  actions: ['read', 'edit'],
  subjects: ['doc', 'note'],
  roles: { admin: ['writer'], writer: [], guest: [] },
  rules: [
    { id: 'all-read', effect: 'allow', actions: ['read'], subjects: '*' },
    {
      id: 'writer-edits-own',
      effect: 'allow',
      actions: ['edit'],
      subjects: ['doc'],
      roles: ['writer'],
      when: owns(),
    },
  ],
});
const ac = createAccessControl(policy);

describe('the three question forms agree', () => {
  const permissions = ac.for({ id: 'u1', roles: ['writer'] });

  it('can() is explain().allowed', () => {
    for (const action of ['read', 'edit'] as const) {
      for (const subject of ['doc', 'note'] as const) {
        const context = { resource: { ownerId: 'u1' } };
        expect(permissions.can(action, subject, context)).toBe(
          permissions.explain(action, subject, context).allowed,
        );
      }
    }
  });

  it('assertCan returns quietly when allowed', () => {
    expect(() => permissions.assertCan('read', 'doc')).not.toThrow();
  });

  it('assertCan throws a PermissionDeniedError when denied', () => {
    expect(() => permissions.assertCan('edit', 'note')).toThrow(PermissionDeniedError);
  });
});

describe('the engine holds no state between calls', () => {
  it('answers identically when asked twice', () => {
    const permissions = ac.for({ id: 'u1', roles: ['writer'] });
    const resource = { ownerId: 'u1' };
    const first = permissions.explain('edit', 'doc', { resource });
    const second = permissions.explain('edit', 'doc', { resource });
    expect(second).toEqual(first);
  });

  it('does not mutate the principal, the resource, or the policy', () => {
    const principal = Object.freeze({ id: 'u1', roles: Object.freeze(['writer']) }) as Principal;
    const resource = Object.freeze({ ownerId: 'u1' });
    expect(() => ac.for(principal).can('edit', 'doc', { resource })).not.toThrow();
    expect(principal).toEqual({ id: 'u1', roles: ['writer'] });
    expect(resource).toEqual({ ownerId: 'u1' });
  });

  it('exposes the policy it compiled, unchanged', () => {
    expect(ac.policy).toBe(policy);
  });

  it('two checkers from one instance do not interfere', () => {
    const writer = ac.for({ id: 'u1', roles: ['writer'] });
    const stranger = ac.for({ id: 'u2', roles: ['writer'] });
    const resource = { ownerId: 'u1' };
    expect(writer.can('edit', 'doc', { resource })).toBe(true);
    expect(stranger.can('edit', 'doc', { resource })).toBe(false);
    expect(writer.can('edit', 'doc', { resource })).toBe(true);
  });
});

describe('binding a principal', () => {
  it('treats null and undefined as the same anonymous caller', () => {
    expect(ac.for(null).explain('read', 'doc')).toEqual(ac.for(undefined).explain('read', 'doc'));
  });

  it('expands inherited roles', () => {
    expect([...ac.for({ id: 'u1', roles: ['admin'] }).roles].sort()).toEqual(['admin', 'writer']);
  });

  it('gives an anonymous caller no roles at all', () => {
    expect(ac.for(null).roles.size).toBe(0);
  });

  it('reports roles the policy does not declare, and grants nothing for them', () => {
    const decision = ac
      .for({ id: 'u1', roles: ['Writer', 'ghost', 'ghost'] })
      .explain('edit', 'doc', {
        resource: { ownerId: 'u1' },
      });
    expect(decision.allowed).toBe(false);
    // De-duplicated, and reported only because a rule that silently stops
    // matching anyone is otherwise invisible.
    expect(decision.unknownRoles).toEqual(['Writer', 'ghost']);
  });

  it('omits unknownRoles entirely when every claimed role is declared', () => {
    expect(ac.for({ id: 'u1', roles: ['writer'] }).explain('read', 'doc')).not.toHaveProperty(
      'unknownRoles',
    );
  });
});

describe('wildcards', () => {
  it("a rule with subjects '*' applies to every declared subject", () => {
    const permissions = ac.for(null);
    expect(permissions.can('read', 'doc')).toBe(true);
    expect(permissions.can('read', 'note')).toBe(true);
  });

  it("a rule with subjects '*' still does not reach an undeclared subject", () => {
    const widened: AccessControl = ac;
    expect(widened.for(null).explain('read', 'ledger').reason).toBe('unknown_subject');
  });

  it("a rule with actions '*' still does not reach an undeclared action", () => {
    const widened: AccessControl = createAccessControl(sharedPolicy);
    expect(widened.for({ id: 'a', roles: ['admin'] }).explain('purge', 'post').reason).toBe(
      'unknown_action',
    );
  });
});

describe('explain echoes the question back', () => {
  it('carries the action and subject that were asked about', () => {
    const decision = ac.for(null).explain('read', 'doc');
    expect(decision.action).toBe('read');
    expect(decision.subject).toBe('doc');
  });

  it('omits ruleId when the rule that decided had none', () => {
    const anonymousPolicy = definePolicy({
      actions: ['read'],
      subjects: ['doc'],
      rules: [{ effect: 'allow', actions: ['read'], subjects: ['doc'] }],
    });
    expect(
      createAccessControl(anonymousPolicy).for(null).explain('read', 'doc'),
    ).not.toHaveProperty('ruleId');
  });
});
