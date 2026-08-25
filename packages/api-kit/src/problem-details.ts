import { normalizeError } from './internal/normalize-error.js';
import { statusText } from './internal/status-text.js';

/**
 * An [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807) problem-details
 * object, as produced by {@link toProblemDetails}.
 *
 * @remarks
 * `code` and `details` are extension members — RFC 7807 explicitly allows
 * a problem type to define additional members beyond `type`/`title`/
 * `status`/`detail`/`instance`. `code` is this ecosystem's machine-readable
 * discriminant (`error.code` from `@firstprinciples/core`); `details` is
 * `error.details`, already documented there as client-visible.
 *
 * @public
 */
export interface ProblemDetails {
  /**
   * A URI identifying the problem *type*. `'about:blank'` (RFC 7807's own
   * example of "no further information available") unless
   * {@link ProblemDetailsOptions.typeBaseUrl} is set, in which case it is
   * `${typeBaseUrl}/${code}` (kebab-cased) — a stable, dereferenceable URI
   * once a docs site exists to serve it.
   */
  readonly type: string;
  /**
   * A short, human-readable summary of the problem *type* — stable across
   * every occurrence of the same `code`, unlike {@link detail}. This is the
   * HTTP status's reason phrase (`statusText`, `./internal/status-text.ts`),
   * not the error's own message: RFC 7807 asks for `title` not to vary
   * occurrence-to-occurrence, and an `AppError`'s `message` is written per
   * occurrence (`"No user 42"`, not `"User not found"`).
   */
  readonly title: string;
  /** The HTTP status code for this occurrence — `error.httpStatus`. */
  readonly status: number;
  /**
   * A human-readable explanation specific to *this* occurrence —
   * `error.message`. Per this ecosystem's `core`/`api-kit` layering
   * decision, `AppError.message` is written to be safe to map here
   * directly, unlike an arbitrary caught error's message (see
   * {@link normalizeError}, `./internal/normalize-error.ts`).
   */
  readonly detail: string;
  /** A URI identifying this specific occurrence, when the caller supplies one via {@link ProblemDetailsOptions."instance"}. */
  readonly instance?: string;
  /** `error.code` — this ecosystem's machine-readable failure identifier. Extension member. */
  readonly code: string;
  /** `error.details`, omitted entirely when `undefined`. Extension member. */
  readonly details?: unknown;
}

/** Options accepted by {@link toProblemDetails} and every adapter's error-formatting entry point. */
export interface ProblemDetailsOptions {
  /**
   * Base URI prefix for {@link ProblemDetails."type"}. When set, `type`
   * becomes `${typeBaseUrl}/${code}` (kebab-cased, trailing slash on
   * `typeBaseUrl` tolerated). Point this at a real docs site once one
   * exists so `type` is genuinely dereferenceable.
   *
   * @defaultValue `undefined` — every `type` is `'about:blank'`.
   */
  readonly typeBaseUrl?: string;
  /** Populates {@link ProblemDetails."instance"} — typically the request's own URL or a request ID. */
  readonly instance?: string;
}

function buildType(code: string, typeBaseUrl: string | undefined): string {
  if (typeBaseUrl === undefined) return 'about:blank';
  const base = typeBaseUrl.endsWith('/') ? typeBaseUrl.slice(0, -1) : typeBaseUrl;
  const slug = code.toLowerCase().replace(/_/g, '-');
  return `${base}/${slug}`;
}

/**
 * Maps any thrown value into an
 * [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807) problem-details object.
 *
 * @param error - Typically an `@firstprinciples/core` `AppError`, but any
 * value is accepted — see {@link normalizeError}, `./internal/normalize-error.ts`,
 * for how a non-`AppError` is handled without leaking its own message.
 * @param options - See {@link ProblemDetailsOptions}.
 *
 * @remarks
 * Builds the output from `error`'s typed fields (`code`, `httpStatus`,
 * `message`, `details`) explicitly, one field at a time — never by
 * spreading `error.toJSON()`. That is deliberate: a field `core` adds to
 * `AppError.toJSON()` in the future must never silently widen this public
 * HTTP response shape (see `EXECUTION-CHECKLIST.md`, "S7 — `core` design
 * decisions", consequence 2).
 *
 * @public
 */
export function toProblemDetails(
  error: unknown,
  options: ProblemDetailsOptions = {},
): ProblemDetails {
  const appError = normalizeError(error);
  return {
    type: buildType(appError.code, options.typeBaseUrl),
    title: statusText(appError.httpStatus),
    status: appError.httpStatus,
    detail: appError.message,
    code: appError.code,
    ...(options.instance === undefined ? {} : { instance: options.instance }),
    ...(appError.details === undefined ? {} : { details: appError.details }),
  };
}
