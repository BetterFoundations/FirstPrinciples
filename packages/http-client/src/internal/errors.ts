import {
  AppError,
  type AppErrorOptions,
  ConflictError,
  ForbiddenError,
  NetworkError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@firstprinciples/core';

/** Narrow `unknown` to an indexable object without asserting a shape. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Builds the {@link NetworkError} for a request that never got a response —
 * `fetch` rejecting is the only way this happens: a DNS/connection failure,
 * or the request's signal aborting.
 *
 * @param aborted - Whether the request's own signal was the reason `fetch`
 * rejected. Not inferred from `cause`'s shape: a caller can pass any value
 * at all to `AbortController#abort(reason)` — a plain string, an `Error`,
 * anything — so only the signal's own `aborted` flag reliably says whether
 * this was an abort. Our internal timeout uses a `DOMException` named
 * `'TimeoutError'` specifically so it can still be told apart from a
 * caller's own abort once `aborted` is `true`.
 */
export function toNetworkError(cause: unknown, url: string, aborted: boolean): NetworkError {
  const isTimeout = aborted && cause instanceof DOMException && cause.name === 'TimeoutError';
  const message = isTimeout
    ? `Request to ${url} timed out`
    : aborted
      ? `Request to ${url} was aborted`
      : `Network request to ${url} failed`;
  return new NetworkError(message, { cause });
}

/** Built-in subclasses this package maps a status code onto. */
const STATUS_ERROR_CONSTRUCTORS: Record<
  number,
  new (message: string, options?: AppErrorOptions) => AppError
> = {
  400: ValidationError,
  401: UnauthorizedError,
  403: ForbiddenError,
  404: NotFoundError,
  409: ConflictError,
};

/** A response body shaped enough to pull an error `message`/`code` from. */
interface ErrorLikeBody {
  readonly message?: unknown;
  readonly code?: unknown;
}

function isErrorLikeBody(body: unknown): body is ErrorLikeBody {
  return isRecord(body);
}

/**
 * Builds the core error for a typed HTTP error response (any status outside
 * 200–299). Maps a handful of common statuses onto the matching built-in
 * `AppError` subclass; anything else falls back to a plain `AppError` with
 * `httpStatus` set to the real status, per core's "httpStatus is always
 * set" convention.
 */
export function toHttpError(response: Response, body: unknown): AppError {
  const Ctor = STATUS_ERROR_CONSTRUCTORS[response.status] ?? null;
  const message =
    (isErrorLikeBody(body) && typeof body.message === 'string' ? body.message : undefined) ??
    `Request failed with status ${String(response.status)} ${response.statusText}`.trim();
  const code = isErrorLikeBody(body) && typeof body.code === 'string' ? body.code : undefined;

  if (Ctor) {
    return new Ctor(message, {
      ...(code === undefined ? {} : { code }),
      details: body,
    });
  }
  return new AppError(message, {
    ...(code === undefined ? {} : { code }),
    httpStatus: response.status,
    details: body,
  });
}
