import { err, ok, type Result, ValidationError } from '@firstprinciples/core';

/**
 * A pluggable validation function — bring your own schema library.
 *
 * @remarks
 * The exact same shape as `@firstprinciples/http-client`'s `ValidateFn`
 * (`http-client`'s validation-adapter decision, S10) — one adapter pattern
 * for the whole ecosystem rather than a second one invented here. Not tied
 * to Zod, Valibot, or any other library: this package imports none of them.
 * Throw to signal a validation failure; {@link runValidation} turns that
 * into a `ValidationError`, never a rejected promise or an uncaught throw.
 *
 * @public
 */
export type ValidateFn = <T>(schema: unknown, data: unknown) => T;

/** Which part of an incoming request {@link ValidationConfig} validates. */
export type ValidationTarget = 'body' | 'headers' | 'params' | 'query';

/** Configuration accepted by every adapter's `validateRequest` and by {@link runValidation}. */
export interface ValidationConfig {
  /** Which part of the request to validate. */
  readonly target: ValidationTarget;
  /** The schema to validate against — passed through to `validate` untouched. */
  readonly schema: unknown;
  /** The validation adapter. See {@link ValidateFn}. */
  readonly validate: ValidateFn;
}

/**
 * Runs a {@link ValidationConfig} against `data`, never throwing.
 *
 * @typeParam T - The validated shape, on success.
 * @param config - Only `schema` and `validate` are read; `target` is used
 * solely to label {@link ValidationError.details} so a client can tell
 * which part of the request failed.
 * @param data - The raw, unvalidated value — an adapter's `req.body`,
 * `req.query`, etc.
 * @returns `ok(value)` with the validator's own return value, or
 * `err(ValidationError)` when `validate` throws.
 *
 * @remarks
 * The underlying schema library's own thrown value is preserved as
 * `cause` (for local logging) but never echoed into the `ValidationError`'s
 * `message` or `details` — schema libraries are not written with a
 * "this message is safe to show a client" contract, the same reasoning
 * `core`'s branded-primitive parsers apply to a rejected value (see
 * `core`'s design decision 7 in `EXECUTION-CHECKLIST.md`).
 *
 * @public
 */
export function runValidation<T>(
  config: Pick<ValidationConfig, 'schema' | 'target' | 'validate'>,
  data: unknown,
): Result<T, ValidationError> {
  try {
    return ok(config.validate<T>(config.schema, data));
  } catch (cause) {
    return err(
      new ValidationError('Request validation failed', {
        code: 'REQUEST_VALIDATION_FAILED',
        details: { target: config.target },
        cause,
      }),
    );
  }
}
