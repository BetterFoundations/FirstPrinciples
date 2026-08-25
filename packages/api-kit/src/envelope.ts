import type { AppError, Result } from '@firstprinciples/core';
import {
  type ProblemDetails,
  type ProblemDetailsOptions,
  toProblemDetails,
} from './problem-details.js';

/**
 * The success branch of an {@link ApiEnvelope} — the standardized shape
 * every `@firstprinciples/api-kit` adapter sends for a 2xx response.
 *
 * @typeParam T - Type of the response payload.
 *
 * @public
 */
export interface SuccessEnvelope<T> {
  /** Discriminant. Always `true` on the success branch. */
  readonly success: true;
  /** The response payload. */
  readonly data: T;
}

/**
 * The failure branch of an {@link ApiEnvelope} — the standardized shape
 * every `@firstprinciples/api-kit` adapter sends for an error response.
 *
 * @public
 */
export interface ErrorEnvelope {
  /** Discriminant. Always `false` on the failure branch. */
  readonly success: false;
  /** The RFC 7807 problem-details object describing the failure. */
  readonly error: ProblemDetails;
}

/**
 * The wire shape of every `@firstprinciples/api-kit` JSON response —
 * a discriminated union on `success`.
 *
 * @typeParam T - Type of the success payload.
 *
 * @remarks
 * This is a **response-body** shape, distinct from `@firstprinciples/core`'s
 * `Result` (an in-memory success/failure value) and from
 * `@firstprinciples/http-client`'s `ApiResult` (that same value widened
 * with transport metadata). `envelopeFromResult` bridges from a `Result`
 * to this shape at the point a handler is ready to respond. Consumed
 * directly by `@firstprinciples/react-query-kit`'s typed hooks.
 *
 * @public
 */
export type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

/**
 * Builds a {@link SuccessEnvelope}.
 *
 * @param data - The response payload.
 *
 * @public
 */
export function toSuccessEnvelope<T>(data: T): SuccessEnvelope<T> {
  return { success: true, data };
}

/**
 * Builds an {@link ErrorEnvelope} from any thrown value.
 *
 * @param error - Typically an `@firstprinciples/core` `AppError`. See
 * {@link toProblemDetails} for how any other value is normalized.
 * @param options - See {@link ProblemDetailsOptions}.
 *
 * @public
 */
export function toErrorEnvelope(error: unknown, options?: ProblemDetailsOptions): ErrorEnvelope {
  return { success: false, error: toProblemDetails(error, options) };
}

/**
 * Builds an {@link ApiEnvelope} from a `@firstprinciples/core` {@link Result}.
 *
 * @param result - The outcome of the operation being responded to.
 * @param options - See {@link ProblemDetailsOptions}.
 *
 * @example
 * ```ts
 * const result = await findUser(id); // Result<User, NotFoundError>
 * const envelope = envelopeFromResult(result);
 * res.status(envelope.success ? 200 : envelope.error.status).json(envelope);
 * ```
 *
 * @public
 */
export function envelopeFromResult<T, E extends AppError = AppError>(
  result: Result<T, E>,
  options?: ProblemDetailsOptions,
): ApiEnvelope<T> {
  return result.ok ? toSuccessEnvelope(result.value) : toErrorEnvelope(result.error, options);
}
