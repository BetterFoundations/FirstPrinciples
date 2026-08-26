import { describe, expect, it } from 'vitest';
import {
  createAccessControl,
  definePolicy,
  type AccessControl,
  type Condition,
  type DecisionReason,
  type Rule,
} from '../../src/index.js';
import { sharedPolicy } from '../shared/policy.js';
import { decisionTable } from '../shared/decision-table.js';
import { contextFor } from '../shared/run-table.js';

/**
 * Rule precedence and conflict resolution, exhaustively.
 *
 * The documented procedure is:
 *
 * 1. undeclared action or subject → deny
 * 2. a matching `deny` that is `true`    → deny
 * 3. a matching `deny` that is `unknown` → deny
 * 4. a matching `allow` that is `true`   → allow
 * 5. otherwise                           → deny
 *
 * Steps 2–5 fold over a *set*, using operations that do not care what
 * order they see it in. This file checks both halves of that: the
 * outcome for every combination of conflicting rules, and the fact that
 * shuffling the rule array never changes one.
 */

/** A condition that is definitely true given `env: { flag: 'yes' }`. */
const definitelyTrue: Condition = { path: 'env.flag', op: 'eq', value: 'yes' };
/** A condition that is definitely false given the same env. */
const definitelyFalse: Condition = { path: 'env.flag', op: 'eq', value: 'no' };
/** A condition nothing in the environment can settle. */
const unknowable: Condition = { path: 'env.absent', op: 'eq', value: 'yes' };

type Verdict = 'absent' | 'true' | 'false' | 'unknown';

const conditions: Record<Exclude<Verdict, 'absent'>, Condition> = {
  true: definitelyTrue,
  false: definitelyFalse,
  unknown: unknowable,
};

function ruleFor(
  effect: 'allow' | 'deny',
  verdict: Verdict,
): Rule<'act', 'thing', never> | undefined {
  if (verdict === 'absent') return undefined;
  return {
    id: `${effect}-${verdict}`,
    effect,
    actions: ['act'],
    subjects: ['thing'],
    // eslint-disable-next-line security/detect-object-injection
    when: conditions[verdict],
  };
}

function decideWith(allowVerdict: Verdict, denyVerdict: Verdict) {
  const rules = [ruleFor('allow', allowVerdict), ruleFor('deny', denyVerdict)].filter(
    (rule): rule is Rule<'act', 'thing', never> => rule !== undefined,
  );
  const policy = definePolicy({ actions: ['act'], subjects: ['thing'], rules });
  return createAccessControl(policy)
    .for({ id: 'u1' })
    .explain('act', 'thing', { env: { flag: 'yes' } });
}

describe('conflict resolution: every combination of one allow and one deny', () => {
  const verdicts: readonly Verdict[] = ['absent', 'true', 'false', 'unknown'];

  /**
   * The full 4×4 matrix, written out rather than computed, so the table
   * itself is reviewable. A deny decides whenever it is not definitely
   * ruled out; an allow decides only when it is definitely satisfied.
   */
  const expected: Record<Verdict, Record<Verdict, [boolean, DecisionReason]>> = {
    // [allowVerdict][denyVerdict]
    absent: {
      absent: [false, 'no_matching_rule'],
      true: [false, 'explicit_deny'],
      false: [false, 'no_matching_rule'],
      unknown: [false, 'unresolved_deny'],
    },
    true: {
      absent: [true, 'allowed'],
      true: [false, 'explicit_deny'],
      false: [true, 'allowed'],
      unknown: [false, 'unresolved_deny'],
    },
    false: {
      absent: [false, 'no_matching_rule'],
      true: [false, 'explicit_deny'],
      false: [false, 'no_matching_rule'],
      unknown: [false, 'unresolved_deny'],
    },
    unknown: {
      absent: [false, 'no_matching_rule'],
      true: [false, 'explicit_deny'],
      false: [false, 'no_matching_rule'],
      unknown: [false, 'unresolved_deny'],
    },
  };

  for (const allowVerdict of verdicts) {
    for (const denyVerdict of verdicts) {
      // eslint-disable-next-line security/detect-object-injection
      const [allowed, reason] = expected[allowVerdict][denyVerdict];
      it(`allow=${allowVerdict}, deny=${denyVerdict} → ${allowed ? 'allow' : 'deny'} (${reason})`, () => {
        const decision = decideWith(allowVerdict, denyVerdict);
        expect(decision.allowed).toBe(allowed);
        expect(decision.reason).toBe(reason);
      });
    }
  }

  it('never allows on an unknown allow, in any pairing', () => {
    for (const denyVerdict of verdicts) {
      expect(decideWith('unknown', denyVerdict).allowed).toBe(false);
    }
  });

  it('always denies on an unknown deny, in any pairing', () => {
    for (const allowVerdict of verdicts) {
      expect(decideWith(allowVerdict, 'unknown').allowed).toBe(false);
    }
  });
});

describe('conflict resolution among several rules of the same effect', () => {
  const base = { actions: ['act'] as const, subjects: ['thing'] as const };

  it('one definite deny outranks any number of allows', () => {
    const policy = definePolicy({
      ...base,
      rules: [
        { id: 'a1', effect: 'allow', actions: '*', subjects: '*' },
        { id: 'a2', effect: 'allow', actions: ['act'], subjects: ['thing'] },
        { id: 'd1', effect: 'deny', actions: ['act'], subjects: ['thing'], when: definitelyTrue },
      ],
    });
    const decision = createAccessControl(policy)
      .for(null)
      .explain('act', 'thing', { env: { flag: 'yes' } });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('explicit_deny');
  });

  it('reports a definite deny in preference to an unresolved one', () => {
    const policy = definePolicy({
      ...base,
      rules: [
        { id: 'a1', effect: 'allow', actions: '*', subjects: '*' },
        {
          id: 'd-unknown',
          effect: 'deny',
          actions: ['act'],
          subjects: ['thing'],
          when: unknowable,
        },
        {
          id: 'd-true',
          effect: 'deny',
          actions: ['act'],
          subjects: ['thing'],
          when: definitelyTrue,
        },
      ],
    });
    const decision = createAccessControl(policy)
      .for(null)
      .explain('act', 'thing', { env: { flag: 'yes' } });
    expect(decision.reason).toBe('explicit_deny');
    expect(decision.ruleId).toBe('d-true');
  });

  it('a deny ruled out by its condition does not block an allow', () => {
    const policy = definePolicy({
      ...base,
      rules: [
        { id: 'a1', effect: 'allow', actions: ['act'], subjects: ['thing'] },
        { id: 'd1', effect: 'deny', actions: ['act'], subjects: ['thing'], when: definitelyFalse },
      ],
    });
    expect(
      createAccessControl(policy)
        .for(null)
        .can('act', 'thing', { env: { flag: 'yes' } }),
    ).toBe(true);
  });

  it('a deny inherited through a role hierarchy still applies to the inheriting role', () => {
    const policy = definePolicy({
      ...base,
      roles: { admin: ['author'], author: [] },
      rules: [
        { id: 'admin-all', effect: 'allow', actions: '*', subjects: '*', roles: ['admin'] },
        {
          id: 'authors-blocked',
          effect: 'deny',
          actions: ['act'],
          subjects: ['thing'],
          roles: ['author'],
        },
      ],
    });
    // The admin *is* an author here, so the author-targeted deny reaches
    // them. There is no ordering escape hatch — narrow the deny instead.
    const decision = createAccessControl(policy)
      .for({ id: 'u1', roles: ['admin'] })
      .explain('act', 'thing');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('explicit_deny');
    expect(decision.ruleId).toBe('authors-blocked');
  });
});

/** Deterministic shuffle, so a failure is reproducible from its seed. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    // xorshift32 — no crypto needed, just repeatability.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const j = state % (i + 1);
    // Both indices are derived from the array's own length, so neither
    // is caller-influenced.
    /* eslint-disable security/detect-object-injection */
    const a = out[i];
    const b = out[j];
    /* c8 ignore next -- both indices are in range by construction */
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
    /* eslint-enable security/detect-object-injection */
  }
  return out;
}

/** Every permutation of a small array. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) out.push([item, ...tail]);
  });
  return out;
}

describe('rule order never changes a decision', () => {
  it('holds across all 720 permutations of a six-rule policy', () => {
    type DocRule = Rule<'read' | 'edit', 'doc', 'admin' | 'writer' | 'banned'>;
    const rules: DocRule[] = [
      { id: 'r1', effect: 'allow', actions: '*', subjects: '*', roles: ['admin'] },
      { id: 'r2', effect: 'allow', actions: ['read'], subjects: ['doc'] },
      {
        id: 'r3',
        effect: 'allow',
        actions: ['edit'],
        subjects: ['doc'],
        roles: ['writer'],
        when: { path: 'resource.ownerId', op: 'eq', ref: 'principal.id' },
      },
      {
        id: 'r4',
        effect: 'deny',
        actions: ['edit'],
        subjects: ['doc'],
        when: { path: 'resource.frozen', op: 'eq', value: true },
      },
      { id: 'r5', effect: 'deny', actions: '*', subjects: '*', roles: ['banned'] },
      {
        id: 'r6',
        effect: 'allow',
        actions: ['edit'],
        subjects: ['doc'],
        roles: ['admin'],
        when: { path: 'env.override', op: 'eq', value: true },
      },
    ];
    const declaration = {
      actions: ['read', 'edit'] as const,
      subjects: ['doc'] as const,
      roles: { admin: [], writer: [], banned: [] },
    };

    const principals = [
      null,
      { id: 'u1', roles: ['writer'] },
      { id: 'u2', roles: ['admin'] },
      { id: 'u3', roles: ['banned', 'writer'] },
    ];
    const resources = [
      undefined,
      { ownerId: 'u1', frozen: false },
      { ownerId: 'u1', frozen: true },
      { ownerId: 'u9' },
    ];
    const envs = [undefined, { override: true }];

    // Widened so the loops below can pass an action held in a variable.
    const reference: AccessControl = createAccessControl(definePolicy({ ...declaration, rules }));
    const baseline = new Map<string, boolean>();
    const questions: {
      key: string;
      principal: (typeof principals)[number];
      action: string;
      subject: string;
      resource: object | undefined;
      env: object | undefined;
    }[] = [];
    for (const principal of principals) {
      for (const action of ['read', 'edit']) {
        for (const resource of resources) {
          for (const env of envs) {
            const key = JSON.stringify([principal, action, resource, env]);
            questions.push({ key, principal, action, subject: 'doc', resource, env });
            baseline.set(key, reference.for(principal).can(action, 'doc', { resource, env }));
          }
        }
      }
    }

    const orders = permutations(rules);
    expect(orders).toHaveLength(720);
    for (const order of orders) {
      const ac: AccessControl = createAccessControl(definePolicy({ ...declaration, rules: order }));
      for (const question of questions) {
        expect(
          ac.for(question.principal).can(question.action, question.subject, {
            resource: question.resource,
            env: question.env,
          }),
          `order ${order.map((rule) => rule.id).join(',')} changed ${question.key}`,
        ).toBe(baseline.get(question.key));
      }
    }
  });

  it('holds for the shared policy across 200 shuffles of its twelve rules', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const shuffled = definePolicy({
        actions: [...sharedPolicy.actions],
        subjects: [...sharedPolicy.subjects],
        roles: sharedPolicy.roles,
        rules: shuffle(sharedPolicy.rules, seed),
      });
      const ac: AccessControl = createAccessControl(shuffled);
      for (const row of decisionTable) {
        expect(
          ac.for(row.principal).can(row.action, row.subject, contextFor(row)),
          `seed ${seed} changed "${row.name}"`,
        ).toBe(row.allowed);
      }
    }
  });
});
