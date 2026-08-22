/**
 * Syntactic checks behind the branded primitives in `../branded.ts`.
 *
 * Each `check*` returns `undefined` when the value is valid, or a short
 * machine-readable reason when it is not. Reasons never echo the input —
 * a rejected email or token is exactly the kind of value that should not
 * be copied into an error payload that may be logged or returned.
 *
 * Every pattern here is anchored and uses only bounded quantifiers, so
 * none can backtrack catastrophically.
 */

/** Total length cap for an address (RFC 5321 §4.5.3.1.3). */
const EMAIL_MAX_LENGTH = 254;
/** Local-part length cap (RFC 5321 §4.5.3.1.1). */
const EMAIL_LOCAL_MAX_LENGTH = 64;
/** Rejects whitespace and stray `@` in either half of an address. */
const EMAIL_FORBIDDEN = /[\s@]/;

/** Why a value is not a valid `Email`. */
export type EmailFailure =
  'not-a-string' | 'empty' | 'too-long' | 'local-part-too-long' | 'malformed';

/**
 * Pragmatic syntactic check: one `@`, a non-empty local part, and a
 * dotted domain. Deliberately not RFC 5322 — that grammar accepts
 * addresses no real mail system routes, and no regex proves an address
 * is deliverable.
 */
export function checkEmail(value: unknown): EmailFailure | undefined {
  if (typeof value !== 'string') return 'not-a-string';
  if (value.length === 0) return 'empty';
  if (value.length > EMAIL_MAX_LENGTH) return 'too-long';

  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return 'malformed';

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > EMAIL_LOCAL_MAX_LENGTH) return 'local-part-too-long';
  if (EMAIL_FORBIDDEN.test(local) || EMAIL_FORBIDDEN.test(domain)) return 'malformed';
  if (!domain.includes('.')) return 'malformed';
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return 'malformed';

  return undefined;
}

/** RFC 9562 §4: version nibble 1–8, variant nibble 8/9/a/b. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The Nil UUID (RFC 9562 §5.9), widely used as a sentinel. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Why a value is not a valid `UUID`. */
export type UUIDFailure = 'not-a-string' | 'malformed';

/**
 * Accepts the canonical 8-4-4-4-12 form of a versioned UUID, plus the Nil
 * UUID. Case is accepted but never normalized — see `parseUUID`.
 */
export function checkUUID(value: unknown): UUIDFailure | undefined {
  if (typeof value !== 'string') return 'not-a-string';
  if (value === NIL_UUID) return undefined;
  return UUID_PATTERN.test(value) ? undefined : 'malformed';
}

/**
 * RFC 3339 `date-time`, restricted to the uppercase `T`/`Z` spelling that
 * `Date.prototype.toISOString` emits and `Date.parse` reliably accepts.
 */
// safe-regex counts bounded repetitions toward star height, so the optional
// fractional-seconds group trips its heuristic. The pattern is anchored,
// every quantifier has a finite upper bound and no alternation is ambiguous,
// so matching is linear — measured at 0.72 ms against a one-million-character
// adversarial input.
const ISO_PATTERN =
  // eslint-disable-next-line security/detect-unsafe-regex
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-]\d{2}:\d{2}))$/;

/** Why a value is not a valid `ISODateString`. */
export type ISODateStringFailure =
  'not-a-string' | 'malformed' | 'invalid-calendar-date' | 'invalid-time' | 'invalid-offset';

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/**
 * Validates shape *and* calendar arithmetic.
 *
 * The arithmetic is not optional: `new Date('2026-02-31T00:00:00Z')` does
 * not produce an Invalid Date, it silently rolls over to 2026-03-03. A
 * `Number.isNaN(date.getTime())` check would pass a date that does not
 * exist, which is why this works from the captured fields instead.
 */
export function checkISODateString(value: unknown): ISODateStringFailure | undefined {
  if (typeof value !== 'string') return 'not-a-string';

  const match = ISO_PATTERN.exec(value);
  if (match === null) return 'malformed';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (month < 1 || month > 12) return 'invalid-calendar-date';
  if (day < 1 || day > daysInMonth(year, month)) return 'invalid-calendar-date';
  // Leap seconds (`:60`) are legal in RFC 3339 but `Date.parse` rejects
  // them, so accepting them here would brand a string the platform then
  // refuses to parse.
  if (hour > 23 || minute > 59 || second > 59) return 'invalid-time';

  // `undefined` for the `Z` spelling, which needs no range check.
  const offset = match[7];
  if (offset !== undefined) {
    if (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59) {
      return 'invalid-offset';
    }
  }

  return undefined;
}
