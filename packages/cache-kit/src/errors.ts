import { AppError, type AppErrorOptions } from '@firstprinciples/core';

/**
 * A cache backend operation failed — a Redis connection drop, a rejected
 * command, or a stored value that failed to deserialize.
 *
 * @remarks
 * Only {@link createCache}'s `get`, `set`, `invalidate` and
 * `invalidateTag` — the direct backend-facing methods — throw this.
 * `wrap` never does: a backend failure during its internal read or write
 * is swallowed and treated as a miss, because the cache is a performance
 * optimization there, not a correctness dependency. See this package's
 * README for the reasoning.
 *
 * @public
 */
export class CacheBackendError extends AppError {
  /**
   * Narrowed to a string literal so this class is structurally distinct
   * from `core`'s own built-in subclasses — see `AppError.name`.
   */
  declare name: 'CacheBackendError';

  /**
   * @param message - Human-readable description.
   * @param options - See `AppErrorOptions`. `code` defaults to
   * `CACHE_BACKEND_ERROR`; a deserialization failure overrides it to
   * `CACHE_CORRUPT_VALUE` instead.
   */
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      ...options,
      code: options.code ?? 'CACHE_BACKEND_ERROR',
      // A cache backend being unreachable is the same class of transient
      // infrastructure failure `core`'s NetworkError models — 503 is the
      // status it would map to, per `core`'s "httpStatus is always set,
      // even on a failure that never touches HTTP" convention.
      httpStatus: options.httpStatus ?? 503,
    });
    this.name = 'CacheBackendError';
  }
}
