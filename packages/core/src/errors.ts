import { err, ok, type Result } from './result.js';

/**
 * Registry key used to brand every {@link AppError} instance.
 *
 * Taken from the *global* symbol registry (`Symbol.for`) on purpose: two
 * copies of this package loaded in one process — the ESM build and the
 * CJS build, or two versions hoisted side by side — define two distinct
 * `AppError` classes, so `instanceof` across them is `false`. The brand is
 * the same symbol in both copies, which is what makes {@link isAppError}
 * work where `instanceof` cannot.
 */
const APP_ERROR_BRAND = Symbol.for('@firstprinciples/core/AppError');

/**
 * Maximum `cause` chain depth walked by {@link AppError.toJSON} and
 * {@link AppError.fromJSON}. Chains longer than this are truncated rather
 * than followed, so a cyclic or hostile chain cannot exhaust the stack.
 */
const MAX_CAUSE_DEPTH = 16;

/** V8-only helper; absent on JavaScriptCore and SpiderMonkey. */
type CaptureStackTrace = (targetObject: object, constructorOpt?: unknown) => void;

/**
 * Construction options shared by {@link AppError} and every subclass.
 *
 * @public
 */
export interface AppErrorOptions {
  /**
   * Machine-readable, stable identifier for this failure — the field
   * clients and `api-kit` switch on.
   *
   * @defaultValue The subclass default (`NOT_FOUND`, `CONFLICT`, …).
   * Override it to be more specific: `USER_NOT_FOUND`, `EMAIL_TAKEN`.
   */
  readonly code?: string;
  /**
   * HTTP status this failure maps to when surfaced over HTTP.
   *
   * @defaultValue The subclass default (404, 409, …).
   *
   * @remarks
   * Meaningful even for failures that never touch HTTP — it is the
   * ecosystem's single agreed severity/category axis, and it is what
   * `api-kit` reads. A package modelling a non-HTTP failure should pick
   * the status the failure *would* map to (a network timeout: 503).
   */
  readonly httpStatus?: number;
  /**
   * Structured, developer-supplied context — which field failed, which
   * id was missing.
   *
   * @remarks
   * Included verbatim in {@link AppError.toJSON}, so treat it as
   * client-visible: put no secrets or unredacted PII here.
   */
  readonly details?: unknown;
  /**
   * The lower-level error this one wraps. Preserved as the native
   * `Error.cause`, so the original stack stays reachable.
   */
  readonly cause?: unknown;
}

/**
 * Wire shape of an arbitrary error inside a serialized `cause` chain.
 *
 * @remarks
 * Deliberately carries no `stack`. See {@link AppError.toJSON}.
 *
 * @public
 */
export interface SerializedError {
  /** The error's `name` (`'TypeError'`, `'NotFoundError'`, …). */
  readonly name: string;
  /** The error's `message`. */
  readonly message: string;
  /** The wrapped error, if any, already serialized. */
  readonly cause?: SerializedError;
}

/**
 * Wire shape of an {@link AppError}, as produced by
 * {@link AppError.toJSON} and consumed by {@link AppError.fromJSON}.
 *
 * @public
 */
export interface SerializedAppError extends SerializedError {
  /** {@link AppError.code}. */
  readonly code: string;
  /** {@link AppError.httpStatus}. */
  readonly httpStatus: number;
  /** {@link AppError.details}, omitted entirely when `undefined`. */
  readonly details?: unknown;
}

/** Narrow `unknown` to an indexable object without asserting a shape. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** `String(value)` that cannot itself throw. */
function safeStringify(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[unserializable value]';
  }
}

/**
 * Reads one property without letting a hostile or throwing getter escape.
 *
 * Serializing an error happens while something has already gone wrong;
 * throwing from here would discard the original failure in favour of a
 * secondary one.
 */
function safeRead(value: Record<string, unknown>, key: string): unknown {
  try {
    // A read, never a write, and every `key` passed here is a literal
    // in this file — there is no injection sink.
    // eslint-disable-next-line security/detect-object-injection
    return value[key];
  } catch {
    return undefined;
  }
}

/**
 * Serialize any thrown value, following `cause` links while guarding
 * against cycles (`seen`) and unbounded depth.
 */
function serializeUnknownError(
  value: unknown,
  seen: Set<unknown>,
  depth: number,
): SerializedError | undefined {
  if (depth > MAX_CAUSE_DEPTH) return undefined;
  // A missing cause is the absence of a link, not a link to nothing.
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    return { name: 'NonError', message: safeStringify(value) };
  }
  if (seen.has(value)) return undefined;
  seen.add(value);

  const cause = serializeUnknownError(safeRead(value, 'cause'), seen, depth + 1);
  const rawName = safeRead(value, 'name');
  const rawMessage = safeRead(value, 'message');
  const name = typeof rawName === 'string' ? rawName : 'Error';
  const message = typeof rawMessage === 'string' ? rawMessage : safeStringify(value);

  if (isAppError(value)) {
    const serialized: SerializedAppError = {
      name,
      message,
      code: value.code,
      httpStatus: value.httpStatus,
      ...(value.details === undefined ? {} : { details: value.details }),
      ...(cause === undefined ? {} : { cause }),
    };
    return serialized;
  }
  return { name, message, ...(cause === undefined ? {} : { cause }) };
}

/**
 * Base class for every error in this ecosystem.
 *
 * @remarks
 * `AppError` is concrete, not abstract: it doubles as the generic
 * internal error (`INTERNAL_ERROR` / 500) and as the fallback
 * {@link AppError.fromJSON} reconstructs an unrecognised payload into.
 *
 * Subclass it freely. Set `this.name` to a string literal in the
 * subclass constructor — do not rely on `this.constructor.name`, which a
 * minifier will rewrite.
 *
 * @example
 * ```ts
 * throw new ConflictError('Email already registered', {
 *   code: 'EMAIL_TAKEN',
 *   details: { field: 'email' },
 *   cause: dbError,
 * });
 * ```
 *
 * @public
 */
export class AppError extends Error {
  /**
   * The class's identity, and the discriminant for the built-in
   * taxonomy.
   *
   * @remarks
   * Every built-in subclass narrows this to a string literal
   * (`'NotFoundError'`, `'ConflictError'`, …). That is not cosmetic:
   * the subclasses add no other members, so without it TypeScript —
   * being structural — would consider a `ConflictError` assignable to a
   * `NotFoundError`, and `Result<T, NotFoundError>` would silently
   * accept any `AppError`. The literal makes them genuinely distinct
   * types, makes `instanceof` narrow in the negative branch too, and
   * makes `switch (error.name)` exhaustive.
   *
   * It stays `string` on `AppError` itself, so your own subclasses are
   * free to set their own.
   */
  declare name: string;

  /** Machine-readable, stable identifier for this failure. */
  readonly code: string;
  /** HTTP status this failure maps to when surfaced over HTTP. */
  readonly httpStatus: number;
  /**
   * Structured, developer-supplied context, or `undefined`.
   *
   * @remarks
   * Deliberately `unknown` rather than a type parameter. A generic
   * `AppError<TDetails>` reads beautifully at a construction site and
   * then betrays you at the only site that matters: narrowing an
   * `unknown` with `instanceof` instantiates the class at `any`, so
   * `catch (e) \{ if (e instanceof AppError) e.details \}` would hand
   * back `any` — unchecked, at exactly the boundary where untyped data
   * arrives. `unknown` forces the narrow you were going to need anyway.
   *
   * A function that *does* know the shape can say so in its return type;
   * see `BrandValidationError` in this package's branded primitives.
   */
  readonly details: unknown;

  /**
   * @param message - Human-readable description. Safe to show a
   * developer; not necessarily safe to show an end user.
   * @param options - See {@link AppErrorOptions}.
   */
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });

    // Restores the prototype link that `class X extends Error` loses when
    // the class is down-levelled to ES5 — by a consumer's own build, not
    // by ours. Our published output targets ES2022 and keeps native
    // classes, so this is belt-and-braces, not the load-bearing fix.
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = 'AppError';
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.httpStatus = options.httpStatus ?? 500;
    this.details = options.details;

    Object.defineProperty(this, APP_ERROR_BRAND, {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    });

    const capture = (Error as unknown as { captureStackTrace?: CaptureStackTrace })
      .captureStackTrace;
    if (typeof capture === 'function') {
      // Drops the AppError/subclass constructor frames so the stack
      // starts at the throw site.
      capture(this, new.target);
    }
  }

  /**
   * Serializes this error — and its whole `cause` chain — into a
   * plain JSON-safe object.
   *
   * @returns A {@link SerializedAppError}. `details` and `cause` keys are
   * omitted rather than set to `undefined`, so the output round-trips
   * through `JSON.stringify`.
   *
   * @remarks
   * **No `stack` is included, by design.** `JSON.stringify` calls
   * `toJSON` implicitly, so this is the shape that reaches a response
   * body the moment anyone writes `res.json(error)` — and a stack trace
   * in a response body is an information leak. Stacks stay available the
   * ordinary way, on `error.stack` and along `error.cause`; that is also
   * where a logger reads them.
   *
   * Round-trips losslessly over every field it emits:
   * `AppError.fromJSON(e.toJSON())` reproduces name, code, httpStatus,
   * message, details and the full cause chain. Chains deeper than 16, and
   * any cycle, are truncated.
   *
   * @example
   * ```ts
   * JSON.stringify(new NotFoundError('No user 42', { code: 'USER_NOT_FOUND' }));
   * // {"name":"NotFoundError","message":"No user 42","code":"USER_NOT_FOUND","httpStatus":404}
   * ```
   */
  toJSON(): SerializedAppError {
    return serializeUnknownError(this, new Set(), 0) as SerializedAppError;
  }

  /**
   * Rebuilds an {@link AppError} from the output of
   * {@link AppError.toJSON}.
   *
   * @param value - Untrusted input, typically straight off the wire.
   * @returns `ok(error)` with the matching built-in subclass restored
   * (falling back to `AppError` for an unrecognised `name`, with that
   * `name` preserved), or `err(ValidationError)` when `value` is not a
   * serialized error. Never throws.
   *
   * @remarks
   * A custom subclass round-trips its *data* but not its *class* — this
   * registry only knows the built-in taxonomy. Check `error.name` or
   * `error.code` if you need to tell a custom error apart after
   * deserializing.
   *
   * @example
   * ```ts
   * const revived = AppError.fromJSON(await response.json());
   * if (isErr(revived)) return err(new AppError('Malformed error payload'));
   * throw revived.value;
   * ```
   */
  static fromJSON(value: unknown): Result<AppError, ValidationError> {
    const restored = reviveAppError(value, 0);
    if (restored === undefined) {
      return err(
        new ValidationError('Value is not a serialized AppError', {
          code: 'INVALID_SERIALIZED_ERROR',
          details: { expected: 'SerializedAppError', received: typeof value },
        }),
      );
    }
    return ok(restored);
  }
}

/**
 * Input failed validation. Put the offending field(s) in `details`.
 *
 * @remarks Defaults: `code` `VALIDATION_ERROR`, `httpStatus` 400.
 *
 * @public
 */
export class ValidationError extends AppError {
  /**
   * Narrowed to a string literal so this class is structurally distinct
   * from its siblings — see {@link AppError.name}.
   */
  declare name: 'ValidationError';

  /**
   * @param message - Human-readable description.
   * @param options - See {@link AppErrorOptions}.
   */
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      ...options,
      code: options.code ?? 'VALIDATION_ERROR',
      httpStatus: options.httpStatus ?? 400,
    });
    this.name = 'ValidationError';
  }
}

/**
 * The requested resource does not exist.
 *
 * @remarks Defaults: `code` `NOT_FOUND`, `httpStatus` 404.
 *
 * @public
 */
export class NotFoundError extends AppError {
  /**
   * Narrowed to a string literal so this class is structurally distinct
   * from its siblings — see {@link AppError.name}.
   */
  declare name: 'NotFoundError';

  /**
   * @param message - Human-readable description.
   * @param options - See {@link AppErrorOptions}.
   */
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      ...options,
      code: options.code ?? 'NOT_FOUND',
      httpStatus: options.httpStatus ?? 404,
    });
    this.name = 'NotFoundError';
  }
}

/**
 * The caller is authenticated but not allowed to do this.
 *
 * @remarks
 * Defaults: `code` `FORBIDDEN`, `httpStatus` 403. This is the error
 * `@firstprinciples/access-control`'s `assertCan` throws.
 *
 * @public
 */
export class ForbiddenError extends AppError {
  /**
   * Narrowed to a string literal so this class is structurally distinct
   * from its siblings — see {@link AppError.name}.
   */
  declare name: 'ForbiddenError';

  /**
   * @param message - Human-readable description.
   * @param options - See {@link AppErrorOptions}.
   */
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      ...options,
      code: options.code ?? 'FORBIDDEN',
      httpStatus: options.httpStatus ?? 403,
    });
    this.name = 'ForbiddenError';
  }
}

/**
 * The caller is not authenticated, or their credentials are invalid.
 *
 * @remarks
 * Defaults: `code` `UNAUTHORIZED`, `httpStatus` 401 — matching HTTP's own
 * long-standing misnomer, where 401 means *unauthenticated*.
 *
 * @public
 */
export class UnauthorizedError extends AppError {
  /**
   * Narrowed to a string literal so this class is structurally distinct
   * from its siblings — see {@link AppError.name}.
   */
  declare name: 'UnauthorizedError';

  /**
   * @param message - Human-readable description.
   * @param options - See {@link AppErrorOptions}.
   */
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      ...options,
      code: options.code ?? 'UNAUTHORIZED',
      httpStatus: options.httpStatus ?? 401,
    });
    this.name = 'UnauthorizedError';
  }
}

/**
 * The request conflicts with current state — a duplicate unique value, a
 * stale version, a race lost.
 *
 * @remarks Defaults: `code` `CONFLICT`, `httpStatus` 409.
 *
 * @public
 */
export class ConflictError extends AppError {
  /**
   * Narrowed to a string literal so this class is structurally distinct
   * from its siblings — see {@link AppError.name}.
   */
  declare name: 'ConflictError';

  /**
   * @param message - Human-readable description.
   * @param options - See {@link AppErrorOptions}.
   */
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      ...options,
      code: options.code ?? 'CONFLICT',
      httpStatus: options.httpStatus ?? 409,
    });
    this.name = 'ConflictError';
  }
}

/** Built-in subclasses {@link AppError.fromJSON} can restore by name. */
const ERROR_CONSTRUCTORS = new Map<
  string,
  new (message: string, options: AppErrorOptions) => AppError
>([
  ['AppError', AppError],
  ['ValidationError', ValidationError],
  ['NotFoundError', NotFoundError],
  ['ForbiddenError', ForbiddenError],
  ['UnauthorizedError', UnauthorizedError],
  ['ConflictError', ConflictError],
]);

/** Rebuild a non-AppError link in a serialized cause chain. */
function revivePlainError(value: Record<string, unknown>, depth: number): Error {
  const message = typeof value['message'] === 'string' ? value['message'] : '';
  const cause = reviveCause(value['cause'], depth + 1);
  const error = new Error(message, cause === undefined ? undefined : { cause });
  if (typeof value['name'] === 'string') error.name = value['name'];
  return error;
}

/** Rebuild one link of a serialized cause chain, AppError or not. */
function reviveCause(value: unknown, depth: number): Error | undefined {
  if (depth > MAX_CAUSE_DEPTH || !isRecord(value)) return undefined;
  return reviveAppError(value, depth) ?? revivePlainError(value, depth);
}

/**
 * Rebuild a serialized {@link AppError}, or `undefined` if `value` does
 * not have the shape of one.
 */
function reviveAppError(value: unknown, depth: number): AppError | undefined {
  if (depth > MAX_CAUSE_DEPTH || !isRecord(value)) return undefined;

  const name = value['name'];
  const message = value['message'];
  const code = value['code'];
  const httpStatus = value['httpStatus'];
  if (
    typeof name !== 'string' ||
    typeof message !== 'string' ||
    typeof code !== 'string' ||
    typeof httpStatus !== 'number'
  ) {
    return undefined;
  }

  const Constructor = ERROR_CONSTRUCTORS.get(name) ?? AppError;
  const cause = reviveCause(value['cause'], depth + 1);
  const error = new Constructor(message, {
    code,
    httpStatus,
    ...('details' in value ? { details: value['details'] } : {}),
    ...(cause === undefined ? {} : { cause }),
  });
  // Preserves the name of a custom subclass this registry cannot know.
  error.name = name;
  return error;
}

/**
 * Type guard for {@link AppError}, working across duplicate copies of
 * this package.
 *
 * @param value - Any value, typically from a `catch` block.
 * @returns `true` when `value` was built by an `AppError` constructor
 * from *any* copy of `@firstprinciples/core` in the process.
 *
 * @remarks
 * Prefer plain `instanceof` — it is clearer, and it narrows to a specific
 * subclass. Reach for `isAppError` at a boundary where the error may have
 * crossed between the ESM and CJS builds of this package, or between two
 * hoisted versions of it: there, `instanceof` is `false` even though the
 * value really is an `AppError`. This guard tests a `Symbol.for` brand,
 * which is shared across all such copies.
 *
 * It narrows to the base class only. Discriminate further on
 * `error.name` or `error.code`, which survive the same boundary.
 *
 * @example
 * ```ts
 * catch (error) {
 *   if (isAppError(error)) return reply.status(error.httpStatus).send(error.toJSON());
 *   throw error;
 * }
 * ```
 *
 * @public
 */
export function isAppError(value: unknown): value is AppError {
  return isRecord(value) && APP_ERROR_BRAND in value;
}
