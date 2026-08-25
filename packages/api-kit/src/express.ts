import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import {
  buildErrorResponse,
  buildSuccessResponse,
  extractTarget,
  storeValid,
} from './internal/adapter-core.js';
import type { ProblemDetailsOptions } from './problem-details.js';
import { runValidation, type ValidationConfig, type ValidationTarget } from './validation.js';

/**
 * Express integration for `@firstprinciples/api-kit`.
 *
 * @remarks
 * `express` is an **optional peer dependency** — importing
 * `@firstprinciples/api-kit` itself never pulls this module in; only a
 * consumer that imports `@firstprinciples/api-kit/express` needs Express
 * installed at all.
 *
 * @packageDocumentation
 */

/**
 * Sends a {@link SuccessEnvelope}.
 *
 * @param res - The Express response.
 * @param data - The response payload.
 * @param status - HTTP status. Defaults to `200`.
 *
 * @public
 */
export function sendSuccess(res: Response, data: unknown, status = 200): void {
  const built = buildSuccessResponse(data, status);
  res.status(built.status).type(built.contentType).json(built.body);
}

/**
 * Sends an {@link ErrorEnvelope} built from `error`.
 *
 * @param res - The Express response.
 * @param error - Typically an `@firstprinciples/core` `AppError`.
 * @param options - See {@link ProblemDetailsOptions}.
 *
 * @public
 */
export function sendError(res: Response, error: unknown, options?: ProblemDetailsOptions): void {
  const built = buildErrorResponse(error, options);
  res.status(built.status).type(built.contentType).json(built.body);
}

/**
 * Express error-handling middleware — register it **last**, after every
 * route and other middleware, per Express's own convention for a 4-arg
 * handler.
 *
 * @param options - See {@link ProblemDetailsOptions}.
 *
 * @remarks
 * Catches both an `AppError` a route deliberately threw (or passed to
 * `next(error)`) and the `ValidationError` a {@link validateRequest}
 * failure produces the same way. Any non-`AppError` is normalized without
 * leaking its own message — see `./internal/normalize-error.ts`.
 *
 * @example
 * ```ts
 * app.get('/users/:id', (req, res) => {
 *   const user = findUser(req.params.id);
 *   if (!user) throw new NotFoundError(`No user ${req.params.id}`);
 *   sendSuccess(res, user);
 * });
 * app.use(apiKitErrorHandler());
 * ```
 *
 * @public
 */
export function apiKitErrorHandler(options?: ProblemDetailsOptions): ErrorRequestHandler {
  // Express recognizes error-handling middleware by arity — a function
  // declaring exactly 4 parameters — so `_next` must stay declared even
  // though it is never called; this handler is always the end of the chain.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (error, _req, res, _next) => {
    sendError(res, error, options);
  };
}

/**
 * Express request-validation middleware, using a schema-library-agnostic
 * {@link ValidateFn}.
 *
 * @param config - See {@link ValidationConfig}.
 * @returns A middleware that, on success, calls `next()` and stores the
 * validated value at `res.locals.valid[config.target]`; on failure, calls
 * `next(validationError)` so it reaches {@link apiKitErrorHandler}
 * (register that too — this middleware never sends a response itself).
 *
 * @example
 * ```ts
 * app.post(
 *   '/users',
 *   validateRequest({ target: 'body', schema: createUserSchema, validate: zodValidate }),
 *   (req, res) => {
 *     const body = (res.locals.valid as { body: CreateUserInput }).body;
 *     sendSuccess(res, createUser(body), 201);
 *   },
 * );
 * ```
 *
 * @public
 */
export function validateRequest(config: ValidationConfig): RequestHandler {
  return (req, res, next) => {
    const result = runValidation(config, extractTarget(req, config.target));
    if (!result.ok) {
      next(result.error);
      return;
    }
    const bag = (res.locals['valid'] ??= {}) as Partial<Record<ValidationTarget, unknown>>;
    storeValid(bag, config.target, result.value);
    next();
  };
}
