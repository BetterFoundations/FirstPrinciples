import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import type { PermissionContext, Principal } from './decision.js';
import type { AccessControl, PermissionChecker } from './engine.js';

/**
 * React bindings for `@firstprinciples/access-control`.
 *
 * @remarks
 * `react` is an **optional peer dependency** — importing
 * `@firstprinciples/access-control` itself never pulls this module in.
 *
 * These components answer with the *same engine and the same policy* the
 * server uses. That is the point of the package, and it is also the
 * thing most likely to be misread, so it is worth stating plainly:
 *
 * **A client-side check is a UX affordance, never a security control.**
 * It decides whether to render a button. It cannot decide whether the
 * request behind the button is permitted, because everything it runs on
 * — the policy, the principal, the engine — is under the caller's
 * control. Guard the route on the server too, with the same policy. The
 * value of sharing the rules is that the button and the endpoint agree,
 * not that one can stand in for the other.
 *
 * Shipping a policy to a browser also discloses it. If a rule's mere
 * existence is sensitive, do not send that rule.
 *
 * @packageDocumentation
 */

/**
 * Holds the checker for the current principal.
 *
 * `null` means no provider is mounted, which {@link usePermissions}
 * turns into a thrown error rather than a silent deny — a missing
 * provider is a wiring mistake, and a UI that quietly renders nothing is
 * the hardest version of it to find.
 */
const CheckerContext = createContext<PermissionChecker | null>(null);

/** Props for {@link AccessControlProvider}. */
export interface AccessControlProviderProps {
  /**
   * The compiled policy, from `createAccessControl`.
   *
   * @remarks
   * Typed at the widened `AccessControl` because a browser typically
   * receives its policy at runtime — see {@link parsePolicy} — where
   * literal action and subject types cannot exist. A policy defined
   * statically with `definePolicy` is assignable here unchanged.
   */
  readonly accessControl: AccessControl;
  /**
   * The signed-in caller, or `null` while signed out.
   *
   * @remarks
   * Treat it as immutable and replace it on change. Mutating the same
   * object in place will not re-derive anything, because the memo below
   * keys on its identity.
   */
  readonly principal: Principal | null | undefined;
  /** The tree that may ask permission questions. */
  readonly children?: ReactNode;
}

/**
 * Binds a policy and a principal for the tree below it.
 *
 * @param props - See {@link AccessControlProviderProps}.
 *
 * @example
 * ```tsx
 * <AccessControlProvider accessControl={ac} principal={session.user}>
 *   <App />
 * </AccessControlProvider>
 * ```
 *
 * @public
 */
export function AccessControlProvider(props: AccessControlProviderProps): ReactNode {
  const { accessControl, principal, children } = props;
  // Re-derived whenever either input's identity changes, which is what
  // makes a sign-out take effect: the new principal produces a new
  // checker, and every consumer re-renders against it.
  const checker = useMemo(() => accessControl.for(principal), [accessControl, principal]);
  return createElement(CheckerContext.Provider, { value: checker }, children);
}

/**
 * The checker for the current principal.
 *
 * @returns The bound {@link PermissionChecker} — `can`, `assertCan`,
 * `explain`, and the resolved role set.
 *
 * @throws If no {@link AccessControlProvider} is mounted above.
 *
 * @remarks
 * Use it when one component asks several questions, or needs
 * `explain()`. For a single question, {@link usePermission} reads
 * better.
 *
 * @public
 */
export function usePermissions(): PermissionChecker {
  const checker = useContext(CheckerContext);
  if (checker === null) {
    throw new Error(
      'usePermissions must be used inside an <AccessControlProvider>. Rendering nothing instead would hide the mistake.',
    );
  }
  return checker;
}

/**
 * Whether the current principal may take `action` on `subject`.
 *
 * @param action - A declared action. An undeclared one answers `false`.
 * @param subject - A declared subject. An undeclared one answers `false`.
 * @param context - Attributes for this check — most often
 * `\{ resource: theThing \}`.
 *
 * @remarks
 * Recomputed every render rather than memoized. The decision is a walk
 * over a pre-indexed rule list, and the natural memo key — the context
 * object — is usually a fresh literal each render, so a `useMemo` here
 * would be a cache that never hits while looking like one that does.
 *
 * @example
 * ```tsx
 * const canEdit = usePermission('update', 'post', { resource: post });
 * return <button disabled={!canEdit}>Edit</button>;
 * ```
 *
 * @public
 */
export function usePermission(
  action: string,
  subject: string,
  context?: PermissionContext,
): boolean {
  return usePermissions().can(action, subject, context);
}

/** Props for {@link Can}. */
export interface CanProps {
  /** A declared action. An undeclared one renders the fallback. */
  readonly action: string;
  /** A declared subject. An undeclared one renders the fallback. */
  readonly subject: string;
  /** The instance being acted on, for ownership and attribute rules. */
  readonly resource?: object | null | undefined;
  /** Ambient attributes, for rules that read `env.*`. */
  readonly env?: object | null | undefined;
  /** Rendered instead when the answer is no. Defaults to nothing. */
  readonly fallback?: ReactNode;
  /**
   * Rendered when the answer is yes.
   *
   * @remarks
   * As a function, it is called either way with the answer — the escape
   * hatch for disabling a control rather than hiding it, which is
   * usually the kinder interface.
   */
  readonly children?: ReactNode | ((allowed: boolean) => ReactNode);
}

/**
 * Renders its children only if the current principal is permitted.
 *
 * @param props - See {@link CanProps}.
 *
 * @remarks
 * The same decision the server guard will make, from the same policy —
 * which is the whole reason to reach for this rather than a hand-written
 * `user.role === 'admin'`. It is still only a rendering decision; see
 * this module's remarks.
 *
 * @example
 * ```tsx
 * <Can action="delete" subject="post" resource={post}>
 *   <DeleteButton />
 * </Can>
 *
 * <Can action="publish" subject="post" resource={post}>
 *   {(allowed) => <button disabled={!allowed}>Publish</button>}
 * </Can>
 * ```
 *
 * @public
 */
export function Can(props: CanProps): ReactNode {
  const { action, subject, resource, env, fallback, children } = props;
  const allowed = usePermissions().can(action, subject, { resource, env });
  if (typeof children === 'function') return children(allowed);
  if (!allowed) return fallback ?? null;
  return children ?? null;
}
