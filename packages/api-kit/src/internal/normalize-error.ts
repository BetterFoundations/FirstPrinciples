import { AppError, isAppError } from '@firstprinciples/core';

/**
 * Shown for any error that is not already an {@link AppError}. Deliberately
 * generic: an arbitrary thrown value — a driver error, a library internal,
 * a plain `throw 'oops'` — was never written with a client audience in
 * mind and may carry connection strings, file paths, or other internals.
 * `core`'s own `AppError` messages *are* written for that audience (this is
 * the whole reason a package throws one deliberately), so those pass
 * through unchanged.
 */
const GENERIC_INTERNAL_MESSAGE = 'An unexpected error occurred.';

/**
 * Normalizes any thrown value into an {@link AppError}, never leaking a
 * non-`AppError`'s own message to a caller.
 *
 * @remarks
 * The original value is preserved as `cause` for local logging — but
 * {@link toProblemDetails} (`../problem-details.ts`) builds its output from
 * explicit fields only, never by spreading `error.toJSON()`, so that `cause`
 * (and whatever it carries) never reaches the wire regardless.
 */
export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return new AppError(GENERIC_INTERNAL_MESSAGE, {
    code: 'INTERNAL_ERROR',
    httpStatus: 500,
    cause: error,
  });
}
