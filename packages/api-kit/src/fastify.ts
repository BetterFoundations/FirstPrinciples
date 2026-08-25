import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from 'fastify';
import {
  buildErrorResponse,
  buildSuccessResponse,
  extractTarget,
  storeValid,
} from './internal/adapter-core.js';
import type { ProblemDetailsOptions } from './problem-details.js';
import { runValidation, type ValidationConfig, type ValidationTarget } from './validation.js';

/**
 * Fastify integration for `@firstprinciples/api-kit`.
 *
 * @remarks
 * `fastify` is an **optional peer dependency** — importing
 * `@firstprinciples/api-kit` itself never pulls this module in; only a
 * consumer that imports `@firstprinciples/api-kit/fastify` needs Fastify
 * installed at all.
 *
 * @packageDocumentation
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by {@link validateRequest} on a successful validation, keyed by target. */
    valid: Partial<Record<ValidationTarget, unknown>> | null;
  }
}

/**
 * Sends a {@link SuccessEnvelope}.
 *
 * @param reply - The Fastify reply.
 * @param data - The response payload.
 * @param status - HTTP status. Defaults to `200`.
 *
 * @public
 */
export function sendSuccess(reply: FastifyReply, data: unknown, status = 200): void {
  const built = buildSuccessResponse(data, status);
  reply.status(built.status).type(built.contentType).send(built.body);
}

/**
 * Sends an {@link ErrorEnvelope} built from `error`.
 *
 * @param reply - The Fastify reply.
 * @param error - Typically an `@firstprinciples/core` `AppError`.
 * @param options - See {@link ProblemDetailsOptions}.
 *
 * @public
 */
export function sendError(
  reply: FastifyReply,
  error: unknown,
  options?: ProblemDetailsOptions,
): void {
  const built = buildErrorResponse(error, options);
  reply.status(built.status).type(built.contentType).send(built.body);
}

/**
 * Wires `@firstprinciples/api-kit` into a Fastify instance: a `null`
 * `request.valid` decorator (populated by {@link validateRequest}) and a
 * global error handler that turns any thrown error — an `AppError` from a
 * route, or a {@link ValidationError} from {@link validateRequest} — into
 * the standard error envelope.
 *
 * @param fastify - The Fastify instance to configure.
 * @param options - See {@link ProblemDetailsOptions}.
 *
 * @remarks
 * Call this once, before registering routes. Unlike Express's
 * `apiKitErrorHandler` (added as the last middleware) or Hono's
 * `apiKitErrorHandler` (passed to `app.onError`), Fastify's single
 * `setErrorHandler` slot means this is a single setup call rather than a
 * value passed elsewhere — the underlying error-to-response logic is
 * still the exact same shared `buildErrorResponse`.
 *
 * @example
 * ```ts
 * const app = fastify();
 * registerApiKit(app);
 * app.get('/users/:id', async (request, reply) => {
 *   const user = findUser((request.params as { id: string }).id);
 *   if (!user) throw new NotFoundError('No such user');
 *   sendSuccess(reply, user);
 * });
 * ```
 *
 * @public
 */
export function registerApiKit(fastify: FastifyInstance, options?: ProblemDetailsOptions): void {
  fastify.decorateRequest('valid', null);
  fastify.setErrorHandler<Error>((error, _request, reply) => {
    sendError(reply, error, options);
  });
}

/**
 * Fastify `preHandler` hook that validates part of the request using a
 * schema-library-agnostic {@link ValidateFn}.
 *
 * @param config - See {@link ValidationConfig}.
 * @returns A hook that, on success, stores the validated value at
 * `request.valid[config.target]`; on failure, throws the
 * {@link ValidationError} so it reaches the error handler registered by
 * {@link registerApiKit} (call that too — this hook never sends a
 * response itself).
 *
 * @public
 */
export function validateRequest(config: ValidationConfig): preHandlerHookHandler {
  return async (request) => {
    const result = runValidation(config, extractTarget(request, config.target));
    if (!result.ok) throw result.error;
    const bag = request.valid ?? {};
    storeValid(bag, config.target, result.value);
    request.valid = bag;
  };
}
