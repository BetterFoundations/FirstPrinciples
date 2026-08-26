import type { Request, RequestHandler } from 'express';
import type { AccessControl } from './engine.js';
import {
  authorize,
  type GuardOptions,
  type PermissionGrant,
  type PermissionRequirement,
} from './internal/guard-core.js';

/**
 * Express integration for `@firstprinciples/access-control`.
 *
 * @remarks
 * `express` is an **optional peer dependency** — importing
 * `@firstprinciples/access-control` itself never pulls this module in.
 *
 * @packageDocumentation
 */

export type { GuardOptions, PermissionGrant, PermissionRequirement };

/**
 * Builds the `requirePermission` middleware factory for one policy.
 *
 * @param accessControl - From `createAccessControl`.
 * @param options - Where the caller comes from. See {@link GuardOptions}.
 * @returns `requirePermission(action, subject, requirement?)`, whose
 * `action` and `subject` are constrained to the policy's declared names,
 * so a typo in a route definition does not compile.
 *
 * @remarks
 * On success the middleware calls `next()` and leaves a
 * {@link PermissionGrant} at `res.locals.permission` — including the
 * resource it loaded, so the route need not load it twice. On denial it
 * calls `next(error)` with a `PermissionDeniedError`, which is a
 * `ForbiddenError` from `@firstprinciples/core`; pair it with
 * `@firstprinciples/api-kit`'s `apiKitErrorHandler()` for an RFC 7807
 * response, or handle it yourself.
 *
 * Rejections are routed through `next(error)` explicitly rather than
 * left to the framework, because Express 4 does not catch a rejected
 * promise from an async middleware and the request would hang instead.
 *
 * @example
 * ```ts
 * const requirePermission = createExpressGuard(ac, {
 *   getPrincipal: (req) => req.user ?? null,
 * });
 *
 * app.delete(
 *   '/posts/:id',
 *   requirePermission('delete', 'post', {
 *     getResource: (req) => posts.findById(req.params.id),
 *   }),
 *   (req, res) => {
 *     const { resource } = res.locals.permission as PermissionGrant;
 *     sendSuccess(res, remove(resource));
 *   },
 * );
 * ```
 *
 * @public
 */
export function createExpressGuard<A extends string, S extends string>(
  accessControl: AccessControl<A, S>,
  options: GuardOptions<Request>,
): (action: A, subject: S, requirement?: PermissionRequirement<Request>) => RequestHandler {
  return (action, subject, requirement) => (req, res, next) => {
    authorize(accessControl, options, req, action, subject, requirement).then((grant) => {
      res.locals['permission'] = grant;
      next();
    }, next);
  };
}
