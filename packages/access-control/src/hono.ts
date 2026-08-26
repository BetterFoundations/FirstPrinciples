import type { Context, MiddlewareHandler } from 'hono';
import type { AccessControl } from './engine.js';
import {
  authorize,
  type GuardOptions,
  type PermissionGrant,
  type PermissionRequirement,
} from './internal/guard-core.js';

/**
 * Hono integration for `@firstprinciples/access-control`.
 *
 * @remarks
 * `hono` is an **optional peer dependency** — importing
 * `@firstprinciples/access-control` itself never pulls this module in.
 *
 * @packageDocumentation
 */

export type { GuardOptions, PermissionGrant, PermissionRequirement };

declare module 'hono' {
  interface ContextVariableMap {
    /** Populated by a passing guard; read it with `c.get('permission')`. */
    permission: PermissionGrant;
  }
}

/**
 * Builds the `requirePermission` middleware factory for one policy.
 *
 * @param accessControl - From `createAccessControl`.
 * @param options - Where the caller comes from. See {@link GuardOptions}.
 * @returns `requirePermission(action, subject, requirement?)`, whose
 * `action` and `subject` are constrained to the policy's declared names.
 *
 * @remarks
 * On success the middleware stores a {@link PermissionGrant} in the
 * `'permission'` context variable and calls `next()`. On denial it
 * throws a `PermissionDeniedError`, which reaches whatever you passed to
 * `app.onError` — `api-kit`'s `apiKitErrorHandler()` maps it to a 403
 * problem-details response.
 *
 * @example
 * ```ts
 * const requirePermission = createHonoGuard(ac, {
 *   getPrincipal: (c) => c.get('user') ?? null,
 * });
 *
 * app.delete(
 *   '/posts/:id',
 *   requirePermission('delete', 'post', {
 *     getResource: (c) => posts.findById(c.req.param('id')),
 *   }),
 *   (c) => c.json(remove(c.get('permission').resource)),
 * );
 * ```
 *
 * @public
 */
export function createHonoGuard<A extends string, S extends string>(
  accessControl: AccessControl<A, S>,
  options: GuardOptions<Context>,
): (action: A, subject: S, requirement?: PermissionRequirement<Context>) => MiddlewareHandler {
  return (action, subject, requirement) => async (c, next) => {
    c.set('permission', await authorize(accessControl, options, c, action, subject, requirement));
    await next();
  };
}
