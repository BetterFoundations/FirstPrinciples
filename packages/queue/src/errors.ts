import { AppError, ValidationError, type AppErrorOptions } from '@firstprinciples/core';

/**
 * Throw from a handler when retrying cannot help — the record was deleted,
 * the input is permanently invalid. The job skips its remaining attempts
 * and is dead-lettered with reason `permanent`.
 *
 * @remarks Defaults: `code` `PERMANENT_JOB_FAILURE`, `httpStatus` 422.
 *
 * @public
 */
export class PermanentJobError extends AppError {
  /** Narrowed so this class is distinct from `core`'s built-ins — see `AppError.name`. */
  declare name: 'PermanentJobError';

  /**
   * @param message - Human-readable description.
   * @param options - See `AppErrorOptions`.
   */
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      ...options,
      code: options.code ?? 'PERMANENT_JOB_FAILURE',
      httpStatus: options.httpStatus ?? 422,
    });
    this.name = 'PermanentJobError';
  }
}

/**
 * A payload failed its job's `validate`, or a job name is not in the
 * queue's job map. Thrown (as a rejection) by `add`.
 *
 * @remarks Defaults: `code` `INVALID_JOB_PAYLOAD`, `httpStatus` 400.
 *
 * @public
 */
export class InvalidJobError extends ValidationError {
  /** Narrowed so this class is distinct from `core`'s built-ins — see `AppError.name`. */
  declare name: 'InvalidJobError';

  /**
   * @param message - Human-readable description.
   * @param options - See `AppErrorOptions`.
   */
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'INVALID_JOB_PAYLOAD' });
    this.name = 'InvalidJobError';
  }
}
