import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  createAccessControl,
  isErr,
  parsePolicy,
  type AccessControl,
} from '../../shared/imports.js';
import { AccessControlProvider, Can, usePermission } from '../../../src/react.js';
import { sharedPolicy } from '../../shared/policy.js';
import { decisionTable, type DecisionCase } from '../../shared/decision-table.js';

/**
 * The client half of the isomorphism proof.
 *
 * The React surface runs the **same decision table** the engine suite
 * and all three guard suites run — and it runs it against a policy that
 * has been through `JSON.stringify` and `parsePolicy`, the way a browser
 * actually receives one. So this suite checks two things at once: that
 * the components agree with the engine, and that the rule schema
 * survives the wire without changing a single decision.
 */

const overTheWire = parsePolicy(JSON.parse(JSON.stringify(sharedPolicy)) as unknown);
if (isErr(overTheWire)) throw overTheWire.error;
const clientAc: AccessControl = createAccessControl(overTheWire.value);

function HookProbe({ row }: { row: DecisionCase }): string {
  const allowed = usePermission(row.action, row.subject, {
    resource: row.resource,
    env: row.env,
  });
  return allowed ? 'yes' : 'no';
}

function render(children: React.ReactNode, row: DecisionCase): string {
  return renderToStaticMarkup(
    <AccessControlProvider accessControl={clientAc} principal={row.principal}>
      {children}
    </AccessControlProvider>,
  );
}

describe('the shared decision table, through React', () => {
  it('the wire round-trip preserves the policy exactly', () => {
    expect(JSON.parse(JSON.stringify(overTheWire.value))).toEqual(
      JSON.parse(JSON.stringify(sharedPolicy)),
    );
  });

  it.each(decisionTable)('<Can> — $name', (row) => {
    const markup = render(
      <Can
        action={row.action}
        subject={row.subject}
        resource={row.resource}
        env={row.env}
        fallback={<span>no</span>}
      >
        <span>yes</span>
      </Can>,
      row,
    );
    expect(markup).toBe(row.allowed ? '<span>yes</span>' : '<span>no</span>');
  });

  it.each(decisionTable)('usePermission — $name', (row) => {
    expect(render(<HookProbe row={row} />, row)).toBe(row.allowed ? 'yes' : 'no');
  });
});
