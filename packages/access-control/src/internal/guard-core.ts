import type { Decision, Principal } from '../decision.js';
import type { AccessControl } from '../engine.js';
import { PermissionDeniedError } from '../errors.js';

/**
 * The framework-free half of the Express, Fastify and Hono guards.
 *
 * All three adapters are the same six lines of glue around this: read
 * the principal, optionally load the resource, decide, and either stash
 * the result or throw. Keeping the decision path in one place is what
 * makes "all three adapters behave identically" a structural fact rather
 * than something three copies of a code path have to agree on.
 */

/** A value, or a promise of one. Resource loading is usually a database read. */
export type Awaitable<T> = T | Promise<T>;

/** Wiring shared by every guard built from one access-control instance. */
export interface GuardOptions<Request> {
  /**
   * Produces the caller from the request — typically whatever your
   * authentication middleware attached.
   *
   * @remarks
   * Returning `null` or `undefined` means anonymous, which is a real
   * caller the policy may still grant public rights to. **Throwing**
   * means the request fails: the error propagates to your framework's
   * error handler and the route is never reached. It is never converted
   * into an allow, and never quietly into a 403 either — an
   * authentication lookup that broke is not the same event as a caller
   * who was refused.
   */
  readonly getPrincipal: (request: Request) => Awaitable<Principal | null | undefined>;
  /**
   * Called immediately before a denial is thrown. For logging and
   * metrics only — it cannot change the outcome, and it is where
   * `decision.reason` is worth recording, since the thrown error
   * deliberately does not carry it to the client.
   */
  readonly onDeny?: (denial: { readonly decision: Decision; readonly request: Request }) => void;
}

/** Per-route wiring: where this particular check's attributes come from. */
export interface PermissionRequirement<Request> {
  /**
   * Loads the instance being acted on, for rules that compare against
   * its attributes.
   *
   * @remarks
   * Returning `null`/`undefined` — the row does not exist — denies with
   * a 403 rather than a 404, and that is deliberate: answering "no such
   * record" to someone who was not allowed to look tells them something
   * they had not earned. Return the record and let the policy decide, or
   * accept the 403.
   */
  readonly getResource?: (request: Request) => Awaitable<object | null | undefined>;
  /** Supplies ambient attributes for rules that read `env.*`. */
  readonly getEnv?: (request: Request) => Awaitable<object | null | undefined>;
}

/**
 * What a passing guard leaves behind on the request.
 *
 * @remarks
 * The loaded `resource` is the useful part: a route whose guard already
 * fetched the record to check ownership should not fetch it again.
 *
 * @public
 */
export interface PermissionGrant {
  /** The action that was checked. */
  readonly action: string;
  /** The subject it was checked on. */
  readonly subject: string;
  /** Whatever `getResource` returned, if anything. */
  readonly resource: object | null | undefined;
  /** Whatever `getEnv` returned, if anything. */
  readonly env: object | null | undefined;
  /** The full decision, for logging. */
  readonly decision: Decision;
}

/**
 * Resolves a request into a decision and enforces it.
 *
 * @throws `PermissionDeniedError` when denied, after `onDeny` has run.
 */
export async function authorize<Request, A extends string, S extends string>(
  accessControl: AccessControl<A, S>,
  options: GuardOptions<Request>,
  request: Request,
  action: A,
  subject: S,
  requirement: PermissionRequirement<Request> | undefined,
): Promise<PermissionGrant> {
  const principal = await options.getPrincipal(request);
  const resource = await requirement?.getResource?.(request);
  const env = await requirement?.getEnv?.(request);

  const decision = accessControl.for(principal).explain(action, subject, { resource, env });
  if (!decision.allowed) {
    options.onDeny?.({ decision, request });
    throw new PermissionDeniedError(decision);
  }
  return { action, subject, resource, env, decision };
}
