/**
 * `@firstprinciples/core` — the shared foundation every other
 * `@firstprinciples` package depends on, with zero runtime dependencies.
 *
 * Three things, and nothing else:
 *
 * - A **typed error hierarchy** ({@link AppError} and its subclasses)
 *   carrying `code`, `httpStatus` and `details`, serializable with
 *   {@link AppError.toJSON} and restorable with {@link AppError.fromJSON}.
 * - A **`Result` type** ({@link Result}, {@link ok}, {@link err},
 *   {@link isOk}, {@link isErr}) for failures that are expected outcomes
 *   rather than exceptions.
 * - **Branded primitives** ({@link Email}, {@link UUID},
 *   {@link ISODateString}) whose validators return a `Result`.
 *
 * The two compose deliberately: `Result<T>` defaults its error type to
 * `AppError`, so a caller gets exhaustive narrowing from the
 * discriminated union *and* the shared error taxonomy. Nothing here
 * throws.
 *
 * @packageDocumentation
 */

export {
  AppError,
  ConflictError,
  ForbiddenError,
  isAppError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from './errors.js';
export type { AppErrorOptions, SerializedAppError, SerializedError } from './errors.js';

export { err, isErr, isOk, ok } from './result.js';
export type { Err, Ok, Result } from './result.js';

export {
  isEmail,
  isISODateString,
  isUUID,
  parseEmail,
  parseISODateString,
  parseUUID,
} from './branded.js';
export type {
  Brand,
  BrandFailureDetails,
  BrandValidationError,
  Email,
  EmailFailure,
  ISODateString,
  ISODateStringFailure,
  UUID,
  UUIDFailure,
} from './branded.js';
