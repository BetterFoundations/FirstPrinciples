import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { AccessControl } from './engine.js';
import {
  authorize,
  type GuardOptions,
  type PermissionGrant,
  type PermissionRequirement,
} from './internal/guard-core.js';

/**
 * Fastify integration for `@firstprinciples/access-control`.
 *
 * @remarks
 * `fastify` is an **optional peer dependency** — importing
 * `@firstprinciples/access-control` itself never pulls this module in.
 *
 * @packageDocumentation
 */

export type { GuardOptions, PermissionGrant, PermissionRequirement };

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by a passing guard. Declared by {@link registerAccessControl}. */
    permission: PermissionGrant | null;
  }
}

/**
 * Declares the `request.permission` decorator on a Fastify instance.
 *
 * @param fastify - The instance to configure. Call once, before
 * registering routes.
 *
 * @remarks
 * Separate from {@link createFastifyGuard} for the same reason
 * `api-kit`'s `registerApiKit` is separate from its `validateRequest`:
 * Fastify wants request properties declared up front, and that is an
 * instance-level concern rather than a per-route one.
 *
 * @public
 */
export function registerAccessControl(fastify: FastifyInstance): void {
  fastify.decorateRequest('permission', null);
}

/**
 * Builds the `requirePermission` `preHandler` factory for one policy.
 *
 * @param accessControl - From `createAccessControl`.
 * @param options - Where the caller comes from. See {@link GuardOptions}.
 * @returns `requirePermission(action, subject, requirement?)`, whose
 * `action` and `subject` are constrained to the policy's declared names.
 *
 * @remarks
 * On success the hook stores a {@link PermissionGrant} at
 * `request.permission`; call {@link registerAccessControl} on the
 * instance first. On denial it throws a `PermissionDeniedError`, which
 * Fastify routes to `setErrorHandler` — `api-kit`'s `registerApiKit`
 * turns it into a 403 problem-details response with no further wiring.
 *
 * @example
 * ```ts
 * const app = fastify();
 * registerAccessControl(app);
 * const requirePermission = createFastifyGuard(ac, {
 *   getPrincipal: (request) => request.user ?? null,
 * });
 *
 * app.delete('/posts/:id', {
 *   preHandler: requirePermission('delete', 'post', {
 *     getResource: (request) => posts.findById((request.params as { id: string }).id),
 *   }),
 *   handler: async (request, reply) => reply.send(remove(request.permission?.resource)),
 * });
 * ```
 *
 * @public
 */
export function createFastifyGuard<A extends string, S extends string>(
  accessControl: AccessControl<A, S>,
  options: GuardOptions<FastifyRequest>,
): (
  action: A,
  subject: S,
  requirement?: PermissionRequirement<FastifyRequest>,
) => preHandlerHookHandler {
  return (action, subject, requirement) => async (request) => {
    request.permission = await authorize(
      accessControl,
      options,
      request,
      action,
      subject,
      requirement,
    );
  };
}
