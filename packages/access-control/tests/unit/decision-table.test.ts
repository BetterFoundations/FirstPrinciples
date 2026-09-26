import { describe, expect, it } from 'vitest';
import { createAccessControl, type AccessControl } from '../../src/index.js';
import { sharedPolicy } from '../shared/policy.js';
import { decisionTable } from '../shared/decision-table.js';
import { contextFor } from '../shared/run-table.js';

/**
 * The engine's run of the shared decision table — the reference the
 * guard and React suites are then held to.
 *
 * Asserting the `reason` and the deciding rule, not just the boolean, is
 * what stops a row from passing for the wrong cause: an ownership grant
 * that silently degraded into the wildcard admin grant would still
 * answer `true`.
 */
describe('the shared decision table, against the engine', () => {
  // Widened: several rows check undeclared actions and subjects, which
  // the literal-typed API refuses at compile time. See run-table.ts.
  const ac: AccessControl = createAccessControl(sharedPolicy);

  it.each(decisionTable)('$name', (testCase) => {
    const permissions = ac.for(testCase.principal);
    const decision = permissions.explain(testCase.action, testCase.subject, contextFor(testCase));

    expect(decision.allowed).toBe(testCase.allowed);
    expect(decision.reason).toBe(testCase.reason);
    expect(decision.ruleId).toBe(testCase.ruleId);
    expect(permissions.can(testCase.action, testCase.subject, contextFor(testCase))).toBe(
      testCase.allowed,
    );
  });

  it('covers every declared action and subject at least once', () => {
    const actions = new Set(decisionTable.map((row) => row.action));
    const subjects = new Set(decisionTable.map((row) => row.subject));
    for (const action of sharedPolicy.actions) expect(actions).toContain(action);
    for (const subject of sharedPolicy.subjects) expect(subjects).toContain(subject);
  });

  it('covers every rule in the policy as the deciding rule at least once', () => {
    const credited = new Set(decisionTable.map((row) => row.ruleId).filter(Boolean));
    for (const rule of sharedPolicy.rules) expect(credited).toContain(rule.id);
  });
});
