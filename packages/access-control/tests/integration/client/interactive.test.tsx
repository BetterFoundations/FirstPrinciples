// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createAccessControl,
  definePolicy,
  owns,
  type AccessControl,
  type Principal,
} from '../../shared/imports.js';
import { AccessControlProvider, Can, usePermission, usePermissions } from '../../../src/react.js';

/**
 * The React surface in a real DOM, driven through real updates.
 *
 * The SSR suite proves the components agree with the engine. This one
 * covers what a single render cannot: that a *change* propagates. The
 * failure it exists for is specific and nasty — a provider that
 * memoizes its checker on the wrong dependencies keeps showing admin
 * controls after the admin signs out, and every static render still
 * passes.
 */

const policy = definePolicy({
  actions: ['read', 'edit'],
  subjects: ['doc'],
  roles: ['writer'],
  rules: [
    { effect: 'allow', actions: ['read'], subjects: ['doc'] },
    {
      effect: 'allow',
      actions: ['edit'],
      subjects: ['doc'],
      roles: ['writer'],
      when: owns('ownerId'),
    },
  ],
});
const ac: AccessControl = createAccessControl(policy);
const doc = { id: 'd1', ownerId: 'u1' };

const writer: Principal = { id: 'u1', roles: ['writer'] };
const otherWriter: Principal = { id: 'u2', roles: ['writer'] };

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(node: ReactNode): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(node));
}

describe('the provider re-derives when its inputs change', () => {
  /** Swaps the principal on a button click, the way a sign-out does. */
  function App(): ReactNode {
    const [principal, setPrincipal] = useState<Principal | null>(writer);
    return (
      <AccessControlProvider accessControl={ac} principal={principal}>
        <button type="button" onClick={() => setPrincipal(null)}>
          sign out
        </button>
        <button type="button" onClick={() => setPrincipal(otherWriter)}>
          switch user
        </button>
        <Can action="edit" subject="doc" resource={doc} fallback={<span id="out">denied</span>}>
          <span id="out">allowed</span>
        </Can>
      </AccessControlProvider>
    );
  }

  it('signing out revokes what the previous principal could do', () => {
    mount(<App />);
    expect(container.querySelector('#out')?.textContent).toBe('allowed');

    act(() => {
      container.querySelectorAll('button')[0]?.click();
    });
    expect(container.querySelector('#out')?.textContent).toBe('denied');
  });

  it('switching to a different principal re-decides ownership', () => {
    mount(<App />);
    expect(container.querySelector('#out')?.textContent).toBe('allowed');

    act(() => {
      container.querySelectorAll('button')[1]?.click();
    });
    expect(container.querySelector('#out')?.textContent).toBe('denied');
  });

  it('a nested provider overrides the outer principal', () => {
    mount(
      <AccessControlProvider accessControl={ac} principal={writer}>
        <Can action="edit" subject="doc" resource={doc}>
          <span id="outer">outer allowed</span>
        </Can>
        <AccessControlProvider accessControl={ac} principal={otherWriter}>
          <Can
            action="edit"
            subject="doc"
            resource={doc}
            fallback={<span id="inner">inner denied</span>}
          >
            <span id="inner">inner allowed</span>
          </Can>
        </AccessControlProvider>
      </AccessControlProvider>,
    );
    expect(container.querySelector('#outer')?.textContent).toBe('outer allowed');
    expect(container.querySelector('#inner')?.textContent).toBe('inner denied');
  });
});

describe('<Can> rendering', () => {
  it('renders nothing at all when denied with no fallback', () => {
    mount(
      <AccessControlProvider accessControl={ac} principal={null}>
        <Can action="edit" subject="doc" resource={doc}>
          <span>allowed</span>
        </Can>
      </AccessControlProvider>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when allowed with no children', () => {
    mount(
      <AccessControlProvider accessControl={ac} principal={writer}>
        <Can action="read" subject="doc" />
      </AccessControlProvider>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('calls a render-prop child either way, so a control can be disabled rather than hidden', () => {
    mount(
      <AccessControlProvider accessControl={ac} principal={otherWriter}>
        <Can action="edit" subject="doc" resource={doc}>
          {(allowed) => (
            <button type="button" disabled={!allowed}>
              publish
            </button>
          )}
        </Can>
      </AccessControlProvider>,
    );
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
  });

  it('denies an undeclared action rather than throwing mid-render', () => {
    mount(
      <AccessControlProvider accessControl={ac} principal={writer}>
        <Can action="frobnicate" subject="doc" fallback={<span id="out">denied</span>}>
          <span id="out">allowed</span>
        </Can>
      </AccessControlProvider>,
    );
    expect(container.querySelector('#out')?.textContent).toBe('denied');
  });
});

describe('the hooks', () => {
  it('usePermission answers the same question <Can> asks', () => {
    function Probe(): ReactNode {
      const canEdit = usePermission('edit', 'doc', { resource: doc });
      const canRead = usePermission('read', 'doc');
      return <span id="out">{`${String(canEdit)}/${String(canRead)}`}</span>;
    }
    mount(
      <AccessControlProvider accessControl={ac} principal={writer}>
        <Probe />
      </AccessControlProvider>,
    );
    expect(container.querySelector('#out')?.textContent).toBe('true/true');
  });

  it('usePermissions exposes explain() and the resolved role set', () => {
    function Probe(): ReactNode {
      const permissions = usePermissions();
      const decision = permissions.explain('edit', 'doc');
      return <span id="out">{`${decision.reason}:${[...permissions.roles].join(',')}`}</span>;
    }
    mount(
      <AccessControlProvider accessControl={ac} principal={writer}>
        <Probe />
      </AccessControlProvider>,
    );
    expect(container.querySelector('#out')?.textContent).toBe('no_matching_rule:writer');
  });

  it('throws a nameable error when no provider is mounted, rather than silently denying', () => {
    function Orphan(): ReactNode {
      return <span>{String(usePermission('read', 'doc'))}</span>;
    }
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    expect(() => {
      act(() => root.render(<Orphan />));
    }).toThrow(/AccessControlProvider/);
  });
});
