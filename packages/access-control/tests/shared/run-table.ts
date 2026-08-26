import { expect } from 'vitest';
import { createAccessControl, type AccessControl, type Decision } from '../../src/index.js';
import { sharedPolicy } from './policy.js';
import { decisionTable, type DecisionCase } from './decision-table.js';

/**
 * The engine's own answer for a row — the reference every other surface
 * is compared against, computed from the same policy the other surfaces
 * are handed.
 */
export function referenceDecision(testCase: DecisionCase): Decision {
  // Widened to `AccessControl<string, string>` on purpose. The table
  // holds undeclared actions and subjects — that is what several rows
  // are for — and the typed API rejects those at compile time, which is
  // the feature. Widening is the documented escape hatch for an action
  // that arrives as data, and it is safe: an undeclared one is denied
  // before any rule is consulted.
  const ac: AccessControl = createAccessControl(sharedPolicy);
  return ac.for(testCase.principal).explain(testCase.action, testCase.subject, {
    ...(testCase.resource === undefined ? {} : { resource: testCase.resource }),
    ...(testCase.env === undefined ? {} : { env: testCase.env }),
  });
}

/** The context a row implies, in the shape `can()` takes. */
export function contextFor(testCase: DecisionCase): { resource?: object; env?: object } {
  return {
    ...(testCase.resource === undefined ? {} : { resource: testCase.resource }),
    ...(testCase.env === undefined ? {} : { env: testCase.env }),
  };
}

/**
 * Asserts one row against whatever answer a surface produced.
 *
 * @param testCase - The row.
 * @param allowed - What the surface under test decided.
 */
export function expectRow(testCase: DecisionCase, allowed: boolean): void {
  expect(allowed, `${testCase.name} — expected ${testCase.allowed ? 'allow' : 'deny'}`).toBe(
    testCase.allowed,
  );
}

/** Every row, for `it.each`. */
export const rows: readonly DecisionCase[] = decisionTable;
