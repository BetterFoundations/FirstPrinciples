import { ValidationError } from './errors.js';
import { err, ok, type Result } from './result.js';
import {
  checkEmail,
  checkISODateString,
  checkUUID,
  type EmailFailure,
  type ISODateStringFailure,
  type UUIDFailure,
} from './internal/validation.js';

declare const BRAND: unique symbol;

/**
 * Tags a primitive so it is no longer interchangeable with every other
 * value of the same underlying type.
 *
 * @typeParam TValue - The underlying primitive (`string`, `number`, …).
 * @typeParam TBrand - A unique string tag naming the branded type.
 *
 * @remarks
 * The tag exists only in the type system — a branded value *is* the
 * underlying primitive at runtime, with no wrapper and no cost. A plain
 * `string` is not assignable to a branded string, which is the whole
 * point; go the other way with a validator such as {@link parseEmail},
 * or with a deliberate `as` assertion when the value is already known to
 * be valid (a column read back from a database that only ever stores
 * validated addresses).
 *
 * @example Branding your own ids
 * ```ts
 * type UserId = Brand<string, 'UserId'>;
 * type Cents = Brand<number, 'Cents'>;
 *
 * declare function charge(amount: Cents): void;
 * charge(500);            // error: 500 is not Cents
 * charge(500 as Cents);   // deliberate, and greppable
 * ```
 *
 * @public
 */
export type Brand<TValue, TBrand extends string> = TValue & {
  readonly [BRAND]: TBrand;
};

/**
 * A string that has passed {@link isEmail}'s syntactic check.
 *
 * @remarks
 * Syntactic validity is not deliverability. Nothing short of sending mail
 * proves an address exists.
 *
 * @public
 */
export type Email = Brand<string, 'Email'>;

/**
 * A string in the canonical 8-4-4-4-12 UUID form (RFC 9562), or the Nil
 * UUID.
 *
 * @remarks
 * Case is preserved, not normalized — see {@link parseUUID}.
 *
 * @public
 */
export type UUID = Brand<string, 'UUID'>;

/**
 * An RFC 3339 date-time string, in the spelling
 * `Date.prototype.toISOString` produces.
 *
 * @remarks
 * Date-only strings such as `'2026-08-22'` are **not** `ISODateString` —
 * a calendar date and an instant are different things, and conflating
 * them is how timezone bugs start.
 *
 * @public
 */
export type ISODateString = Brand<string, 'ISODateString'>;

export type { EmailFailure, ISODateStringFailure, UUIDFailure } from './internal/validation.js';

/**
 * The `details` payload carried by every branded-primitive rejection.
 *
 * @typeParam TReason - The union of reasons for this particular type —
 * {@link EmailFailure}, {@link UUIDFailure} or
 * {@link ISODateStringFailure}.
 *
 * @remarks
 * `reason` never contains the rejected value, so this payload is safe to
 * log or return as-is.
 *
 * @example
 * ```ts
 * const email = parseEmail(input);
 * if (isErr(email)) {
 *   switch (email.error.details?.reason) {
 *     case 'too-long': return 'That address is too long.';
 *     default: return 'That does not look like an email address.';
 *   }
 * }
 * ```
 *
 * @public
 */
export interface BrandFailureDetails<TReason extends string> {
  /** Name of the branded type the value failed to satisfy. */
  readonly expected: string;
  /** Machine-readable reason. Never contains the rejected value. */
  readonly reason: TReason;
}

/**
 * A {@link ValidationError} whose `details` are known statically.
 *
 * @typeParam TReason - The reason union for the branded type that
 * rejected the value.
 *
 * @remarks
 * `AppError.details` is `unknown`, on purpose — a generic error class
 * degrades to `any` under `instanceof` narrowing. A function that *does*
 * know the shape it put there can still say so, by returning this
 * interface: the runtime value is an ordinary `ValidationError`, and it
 * stays assignable everywhere a `ValidationError` is expected.
 *
 * @public
 */
export interface BrandValidationError<TReason extends string> extends ValidationError {
  readonly details: BrandFailureDetails<TReason> | undefined;
}

/**
 * Builds the rejection every branded-primitive parser returns.
 *
 * The assertion is sound by construction: `details` is the object built
 * on the line above it, so its type is known even though the class
 * declares the field as `unknown`.
 */
function brandFailure<TReason extends string>(spec: {
  readonly message: string;
  readonly code: string;
  readonly expected: string;
  readonly reason: TReason;
}): BrandValidationError<TReason> {
  return new ValidationError(spec.message, {
    code: spec.code,
    details: { expected: spec.expected, reason: spec.reason },
  }) as BrandValidationError<TReason>;
}

/**
 * Narrows a value to {@link Email}.
 *
 * @param value - Any value; non-strings are rejected.
 * @returns `true` when `value` is a syntactically valid email address.
 *
 * @remarks
 * Checks structure only: a non-empty local part of at most 64 characters,
 * exactly one `@`, a dotted domain, no whitespace, 254 characters total.
 * Deliberately not RFC 5322 — that grammar accepts addresses no real mail
 * system routes.
 *
 * @example
 * ```ts
 * const candidates: string[] = ['a@b.com', 'nope'];
 * const valid: Email[] = candidates.filter(isEmail);
 * ```
 *
 * @public
 */
export function isEmail(value: unknown): value is Email {
  return checkEmail(value) === undefined;
}

/**
 * Validates a value as an {@link Email}.
 *
 * @param value - Any value, typically straight off a request body.
 * @returns `ok(email)`, or `err(ValidationError)` with `code`
 * `INVALID_EMAIL`. Never throws.
 *
 * @remarks
 * The error's `details.reason` says *why* the value was rejected
 * (`'malformed'`, `'too-long'`, …) but never repeats the value itself —
 * this package cannot know whether the caller's error payload ends up in
 * a log, and an email address is personal data. Add the value yourself if
 * your context makes that safe.
 *
 * @example
 * ```ts
 * const email = parseEmail(body.email);
 * if (isErr(email)) return reply.status(email.error.httpStatus).send(email.error.toJSON());
 * await sendWelcome(email.value);
 * ```
 *
 * @public
 */
export function parseEmail(value: unknown): Result<Email, BrandValidationError<EmailFailure>> {
  const reason = checkEmail(value);
  if (reason === undefined) return ok(value as Email);
  return err(
    brandFailure({
      message: 'Value is not a valid email address',
      code: 'INVALID_EMAIL',
      expected: 'Email',
      reason,
    }),
  );
}

/**
 * Narrows a value to {@link UUID}.
 *
 * @param value - Any value; non-strings are rejected.
 * @returns `true` when `value` is a canonical UUID (version 1–8, variant
 * `10xx`) or the Nil UUID `00000000-0000-0000-0000-000000000000`.
 *
 * @public
 */
export function isUUID(value: unknown): value is UUID {
  return checkUUID(value) === undefined;
}

/**
 * Validates a value as a {@link UUID}.
 *
 * @param value - Any value, typically a route parameter.
 * @returns `ok(uuid)`, or `err(ValidationError)` with `code`
 * `INVALID_UUID`. Never throws.
 *
 * @remarks
 * Uppercase input is accepted and returned unchanged. This package does
 * not normalize: a `parse` that silently rewrites its input surprises
 * callers who compare strings. RFC 9562 prefers lowercase on output, so
 * lowercase at your own boundary if you compare UUIDs as strings.
 *
 * @example
 * ```ts
 * function getUser(id: string): Promise<Result<User, NotFoundError | ValidationError>> {
 *   const uuid = parseUUID(id);
 *   if (isErr(uuid)) return Promise.resolve(uuid); // Err<ValidationError> widens
 *   return findUser(uuid.value);
 * }
 * ```
 *
 * @public
 */
export function parseUUID(value: unknown): Result<UUID, BrandValidationError<UUIDFailure>> {
  const reason = checkUUID(value);
  if (reason === undefined) return ok(value as UUID);
  return err(
    brandFailure({
      message: 'Value is not a valid UUID',
      code: 'INVALID_UUID',
      expected: 'UUID',
      reason,
    }),
  );
}

/**
 * Narrows a value to {@link ISODateString}.
 *
 * @param value - Any value; non-strings are rejected.
 * @returns `true` when `value` is an RFC 3339 date-time whose calendar
 * date actually exists.
 *
 * @remarks
 * The calendar check is not redundant with `Date.parse`:
 * `new Date('2026-02-31T00:00:00Z')` does not produce an Invalid Date, it
 * rolls silently over to 2026-03-03. This validates the captured fields
 * arithmetically instead, so a date that does not exist is rejected.
 *
 * @public
 */
export function isISODateString(value: unknown): value is ISODateString {
  return checkISODateString(value) === undefined;
}

/**
 * Validates a value as an {@link ISODateString}.
 *
 * @param value - Any value, typically a JSON timestamp field.
 * @returns `ok(timestamp)`, or `err(ValidationError)` with `code`
 * `INVALID_ISO_DATE_STRING`. Never throws.
 *
 * @remarks
 * Accepts a `Z` suffix or a numeric `±HH:MM` offset, and 1–9 fractional
 * second digits. Rejects date-only strings, lowercase `t`/`z`, and leap
 * seconds (`:60`) — the last because `Date.parse` rejects them too, and
 * branding a string the platform then refuses to parse helps nobody.
 *
 * @example
 * ```ts
 * const at = parseISODateString(payload.occurredAt);
 * if (isErr(at)) return err(at.error);
 * const occurredAt = new Date(at.value); // guaranteed to parse
 * ```
 *
 * @public
 */
export function parseISODateString(
  value: unknown,
): Result<ISODateString, BrandValidationError<ISODateStringFailure>> {
  const reason = checkISODateString(value);
  if (reason === undefined) return ok(value as ISODateString);
  return err(
    brandFailure({
      message: 'Value is not a valid ISO 8601 date-time string',
      code: 'INVALID_ISO_DATE_STRING',
      expected: 'ISODateString',
      reason,
    }),
  );
}
