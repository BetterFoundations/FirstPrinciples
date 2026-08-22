import type { AppError } from './errors.js';

/**
 * The success branch of a {@link Result}.
 *
 * @typeParam T - Type of the contained success value.
 *
 * @remarks
 * Exported as a standalone type (rather than being inlined into
 * {@link Result}) so downstream packages can widen a branch without
 * redefining the union. `@firstprinciples/http-client` builds its
 * `ApiResult` as `(Ok<T> & \{ status: number \}) | (Err<E> & \{ ... \})`;
 * the intersection preserves the `ok` literal, so the union stays
 * discriminated and {@link isOk} still narrows it.
 *
 * @public
 */
export interface Ok<T> {
  /** Discriminant. Always `true` on the success branch. */
  readonly ok: true;
  /** The success value. */
  readonly value: T;
}

/**
 * The failure branch of a {@link Result}.
 *
 * @typeParam E - Type of the contained error.
 *
 * @remarks
 * `E` appears only in a readonly position, so `Err` is covariant in `E`:
 * an `Err<NotFoundError>` is assignable to `Err<AppError>`. That is what
 * makes early-return propagation work without a manual re-wrap — see the
 * recipe in this package's README.
 *
 * @public
 */
export interface Err<E> {
  /** Discriminant. Always `false` on the failure branch. */
  readonly ok: false;
  /** The error describing why the operation failed. */
  readonly error: E;
}

/**
 * A value that is either a success (`Ok`) or a failure (`Err`), for
 * operations whose failure is an expected outcome rather than an
 * exceptional one.
 *
 * @typeParam T - Type of the success value.
 * @typeParam E - Type of the error. Defaults to {@link AppError}, the
 * shared error taxonomy, so the common case needs only one type argument.
 *
 * @remarks
 * The `E = AppError` default is the type-level form of this ecosystem's
 * layering rule: a `Result`'s error branch carries a *core error
 * instance*, so callers get exhaustive narrowing from the discriminated
 * union **and** a shared `code` / `httpStatus` / `details` taxonomy.
 *
 * Pass an explicit `E` for a narrower error union, or for a non-error
 * payload:
 *
 * ```ts
 * type Lookup = Result<User, NotFoundError | ValidationError>;
 * type Parsed = Result<number, string>;
 * ```
 *
 * Nothing in this package throws. Operations that can fail return a
 * `Result`; errors are values you construct and hand back.
 *
 * @example Narrowing both branches
 * ```ts
 * const parsed = parseEmail(input);
 * if (isErr(parsed)) {
 *   return parsed.error.httpStatus; // ValidationError
 * }
 * return parsed.value; // Email
 * ```
 *
 * @public
 */
export type Result<T, E = AppError> = Ok<T> | Err<E>;

/**
 * Builds a successful {@link Result} carrying no value, for operations
 * whose only interesting outcome is failure.
 *
 * @returns An `Ok<void>`.
 *
 * @example
 * ```ts
 * function revoke(id: UUID): Result<void, NotFoundError> {
 *   if (!store.delete(id)) return err(new NotFoundError(`No token ${id}`));
 *   return ok();
 * }
 * ```
 *
 * @public
 */
export function ok(): Ok<void>;
/**
 * Builds a successful {@link Result}.
 *
 * @typeParam T - Inferred from `value`.
 * @param value - The success value to carry.
 * @returns An `Ok<T>`.
 *
 * @public
 */
export function ok<T>(value: T): Ok<T>;
export function ok<T>(value?: T): Ok<T | void> {
  return { ok: true, value: value as T };
}

/**
 * Builds a failed {@link Result}.
 *
 * @typeParam E - Inferred from `error`. Usually an {@link AppError}
 * subclass, but any value is allowed.
 * @param error - The error to carry.
 * @returns An `Err<E>`.
 *
 * @example
 * ```ts
 * return err(new NotFoundError(`User ${id} not found`, { code: 'USER_NOT_FOUND' }));
 * ```
 *
 * @public
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Type guard for the success branch.
 *
 * @typeParam T - Type of the success value.
 * @typeParam E - Type of the error.
 * @param result - The result to inspect.
 * @returns `true` when `result` is an {@link Ok}, narrowing it in both
 * branches of the surrounding `if`.
 *
 * @remarks
 * `result.ok` narrows just as well and needs no import; `isOk` exists for
 * the positions a property access cannot reach — `results.filter(isOk)`,
 * and callbacks generally.
 *
 * @public
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/**
 * Type guard for the failure branch.
 *
 * @typeParam T - Type of the success value.
 * @typeParam E - Type of the error.
 * @param result - The result to inspect.
 * @returns `true` when `result` is an {@link Err}, narrowing it in both
 * branches of the surrounding `if`.
 *
 * @public
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}
