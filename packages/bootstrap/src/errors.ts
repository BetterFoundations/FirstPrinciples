import { AppError, ValidationError, type AppErrorOptions } from '@firstprinciples/core';

/**
 * One problem with one environment variable.
 *
 * @public
 */
export interface EnvIssue {
  /** The variable's name, e.g. `DATABASE_URL`. */
  readonly variable: string;
  /** `missing`: unset or empty, with no default. `invalid`: set, but its parser rejected it. */
  readonly problem: 'missing' | 'invalid';
  /** Human-readable. Built-in parsers never include the variable's value — env values are often secrets. */
  readonly message: string;
}

/**
 * The environment failed validation. Carries **every** issue, not the first.
 *
 * @remarks
 * A `ValidationError` subclass (`kind` `'ValidationError'`), but with
 * `httpStatus` 500: a misconfigured server is the server's fault, not the
 * caller's. Defaults: `code` `ENV_VALIDATION_ERROR`, `details` `{ issues }`.
 *
 * @public
 */
export class EnvValidationError extends ValidationError {
  /** Narrowed so this class is distinct from `core`'s built-ins — see `AppError.name`. */
  declare name: 'EnvValidationError';

  /** Every problem found, in the order the spec declares the variables. */
  readonly issues: readonly EnvIssue[];

  /**
   * @param issues - Every problem found. The message is built from them.
   * @param options - See `AppErrorOptions`.
   */
  constructor(issues: readonly EnvIssue[], options: AppErrorOptions = {}) {
    const lines = issues.map((issue) => `${issue.variable}: ${issue.message}`);
    const noun = issues.length === 1 ? 'problem' : 'problems';
    super(`Invalid environment (${issues.length} ${noun}) — ${lines.join('; ')}`, {
      ...options,
      code: options.code ?? 'ENV_VALIDATION_ERROR',
      httpStatus: options.httpStatus ?? 500,
      details: options.details ?? { issues },
    });
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * A lifecycle method was called in a state that does not allow it —
 * registering a resource after `start()`, starting twice, a duplicate name.
 * Always a programming error, never a runtime condition to handle.
 *
 * @remarks Defaults: `code` `LIFECYCLE_ERROR`, `httpStatus` 500.
 *
 * @public
 */
export class LifecycleError extends AppError {
  /** Narrowed so this class is distinct from `core`'s built-ins — see `AppError.name`. */
  declare name: 'LifecycleError';

  /**
   * @param message - Human-readable description.
   * @param options - See `AppErrorOptions`.
   */
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      ...options,
      code: options.code ?? 'LIFECYCLE_ERROR',
      httpStatus: options.httpStatus ?? 500,
    });
    this.name = 'LifecycleError';
  }
}
