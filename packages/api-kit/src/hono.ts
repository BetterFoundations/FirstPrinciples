import { ValidationError } from '@firstprinciples/core';
import type { Context, ErrorHandler, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  type AdapterResponse,
  buildErrorResponse,
  buildSuccessResponse,
  storeValid,
} from './internal/adapter-core.js';
import type { ProblemDetailsOptions } from './problem-details.js';
import { runValidation, type ValidationConfig, type ValidationTarget } from './validation.js';

/**
 * Hono integration for `@firstprinciples/api-kit`.
 *
 * @remarks
 * `hono` is an **optional peer dependency** — importing
 * `@firstprinciples/api-kit` itself never pulls this module in; only a
 * consumer that imports `@firstprinciples/api-kit/hono` needs Hono
 * installed at all.
 *
 * @packageDocumentation
 */

declare module 'hono' {
  interface ContextVariableMap {
    /** Populated by {@link validateRequest} on a successful validation, keyed by target. */
    valid: Partial<Record<ValidationTarget, unknown>>;
  }
}

function respond(c: Context, built: AdapterResponse): Response {
  // `built.status` comes from `AppError.httpStatus` — a plain `number` by
  // core's own design (never a type-level literal union) — so it cannot
  // line up with Hono's narrowed `ContentfulStatusCode` at the type level;
  // it is a real HTTP status by construction (core's own convention: every
  // `AppError` carries one), never a 1xx no-body code, so this cast is safe.
  return c.body(JSON.stringify(built.body), built.status as ContentfulStatusCode, {
    'Content-Type': built.contentType,
  });
}

/**
 * Sends a {@link SuccessEnvelope}.
 *
 * @param c - The Hono context.
 * @param data - The response payload.
 * @param status - HTTP status. Defaults to `200`.
 *
 * @public
 */
export function sendSuccess(c: Context, data: unknown, status = 200): Response {
  return respond(c, buildSuccessResponse(data, status));
}

/**
 * Sends an {@link ErrorEnvelope} built from `error`.
 *
 * @param c - The Hono context.
 * @param error - Typically an `@firstprinciples/core` `AppError`.
 * @param options - See {@link ProblemDetailsOptions}.
 *
 * @public
 */
export function sendError(c: Context, error: unknown, options?: ProblemDetailsOptions): Response {
  return respond(c, buildErrorResponse(error, options));
}

/**
 * Hono error handler — register it via `app.onError(apiKitErrorHandler())`.
 *
 * @param options - See {@link ProblemDetailsOptions}.
 *
 * @remarks
 * Catches both an `AppError` a handler deliberately threw and the
 * {@link ValidationError} a {@link validateRequest} failure produces the
 * same way. Any non-`AppError` is normalized without leaking its own
 * message — see `./internal/normalize-error.ts`.
 *
 * @example
 * ```ts
 * const app = new Hono();
 * app.onError(apiKitErrorHandler());
 * app.get('/users/:id', (c) => {
 *   const user = findUser(c.req.param('id'));
 *   if (!user) throw new NotFoundError('No such user');
 *   return sendSuccess(c, user);
 * });
 * ```
 *
 * @public
 */
export function apiKitErrorHandler(options?: ProblemDetailsOptions): ErrorHandler {
  return (error, c) => sendError(c, error, options);
}

/** Reads the part of a Hono request named by `target`, per Hono's own request API. */
async function extractHono(c: Context, target: ValidationTarget): Promise<unknown> {
  switch (target) {
    case 'body':
      try {
        return await c.req.json();
      } catch (cause) {
        // A body that isn't valid JSON at all is itself a validation
        // failure, not a server error — normalized the same way a schema
        // rejection is, rather than propagating a raw SyntaxError.
        throw new ValidationError('Request body is not valid JSON', {
          code: 'INVALID_JSON_BODY',
          details: { target: 'body' },
          cause,
        });
      }
    case 'headers':
      return c.req.header();
    case 'params':
      return c.req.param();
    case 'query':
      return c.req.query();
  }
}

/**
 * Hono middleware that validates part of the request using a
 * schema-library-agnostic {@link ValidateFn}.
 *
 * @param config - See {@link ValidationConfig}.
 * @returns Middleware that, on success, stores the validated value in the
 * `'valid'` context variable (`c.get('valid')`), keyed by target, and calls
 * `next()`; on failure, throws the {@link ValidationError} so it reaches
 * the handler registered via {@link apiKitErrorHandler} (register that too
 * — this middleware never builds a response itself).
 *
 * @public
 */
export function validateRequest(config: ValidationConfig): MiddlewareHandler {
  return async (c, next) => {
    const data = await extractHono(c, config.target);
    const result = runValidation(config, data);
    if (!result.ok) throw result.error;
    const bag = c.get('valid') ?? {};
    storeValid(bag, config.target, result.value);
    c.set('valid', bag);
    await next();
  };
}
