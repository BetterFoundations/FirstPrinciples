import type { AppError, Err, Ok } from '@firstprinciples/core';

/** HTTP methods this client issues. */
export type HttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

/**
 * The success branch of an {@link ApiResult} — a core {@link Ok} widened
 * with the response's HTTP status.
 *
 * @public
 */
export type ApiOk<T> = Ok<T> & {
  /** The response's HTTP status code. */
  readonly status: number;
};

/**
 * The failure branch of an {@link ApiResult} — a core {@link Err} widened
 * with transport metadata.
 *
 * @remarks
 * `kind` is what lets a caller tell a network failure apart from a typed
 * HTTP error response without inspecting the error instance: `'network'`
 * means the request never got a response at all (`status` is `undefined`),
 * `'http'` means a response came back outside the 2xx range, and
 * `'validation'` means a response validated against the configured schema
 * failed.
 *
 * @public
 */
export type ApiErr<E extends AppError = AppError> = Err<E> & {
  /**
   * The response's HTTP status code, or `undefined` when no response was
   * ever received (`kind === 'network'`).
   */
  readonly status: number | undefined;
  /** Which of the three failure modes this is. */
  readonly kind: 'http' | 'network' | 'validation';
};

/**
 * The result of a single request — every client method and endpoint
 * function returns this instead of throwing.
 *
 * @typeParam T - The success value's type.
 * @typeParam E - The error's type. Defaults to {@link AppError}, matching
 * core's own `Result` default.
 *
 * @remarks
 * `ApiResult` is `Result<T, E>` widened with transport metadata (see the
 * `core`/`http-client` layering decision in this repo's
 * `EXECUTION-CHECKLIST.md`) — `@firstprinciples/core`'s own `isOk` / `isErr`
 * narrow it without losing `status` or `kind`, and it stays assignable back
 * to a plain `Result` for a caller that does not care about transport
 * detail.
 *
 * @public
 */
export type ApiResult<T, E extends AppError = AppError> = ApiOk<T> | ApiErr<E>;

/**
 * The outgoing request, as seen by {@link ClientConfig.onRequest}.
 *
 * @remarks
 * `signal` is already the combined timeout+caller signal by the time
 * `onRequest` sees it — mutate `headers`/`body`, don't touch `signal`.
 *
 * @public
 */
export interface RequestContext {
  /** Full request URL, including the client's `baseUrl`. */
  url: string;
  /** The HTTP method for this request. */
  method: HttpMethod;
  /** Mutable request headers — safe to add to (e.g. inject `Authorization`). */
  headers: Record<string, string>;
  /** The already-serialized request body, or `undefined` for none. */
  body: string | undefined;
  /** The combined timeout+caller-abort signal for this attempt. */
  readonly signal: AbortSignal;
}

/**
 * The raw response, as seen by {@link ClientConfig.onResponse}, before it is
 * parsed into an {@link ApiResult}.
 *
 * @remarks
 * Replace `response` to implement a central "401 → refresh token → retry"
 * pattern: detect the 401 on the original response, perform the refresh,
 * re-issue the original request yourself (e.g. via `fetch` directly, to
 * avoid recursing through this client's own retry policy), and return a
 * {@link ResponseContext} wrapping the new `Response`.
 *
 * @public
 */
export interface ResponseContext {
  /** The request that produced this response. */
  readonly request: RequestContext;
  /** The raw `fetch` response. Replace this to short-circuit re-parsing. */
  response: Response;
}

/**
 * Decides whether a failed attempt should be retried.
 *
 * @remarks
 * Receives the same `ApiErr` shape a caller would see, so a custom policy
 * can inspect `kind`, `status`, and `error` together.
 *
 * @public
 */
export type RetryPredicate = (failure: ApiErr) => boolean;

/**
 * Retry policy for a client or a single request.
 *
 * @public
 */
export interface RetryConfig {
  /**
   * Total number of attempts, including the first — not the number of
   * retries. `attempts: 2` means one retry after an initial failure.
   *
   * @defaultValue `2`
   */
  readonly attempts?: number;
  /**
   * Base delay in milliseconds for exponential backoff. The delay before
   * attempt `n` (0-indexed retry count) is drawn uniformly from
   * `[0, backoffMs * 2^n]` — "full jitter" — to avoid a thundering herd of
   * synchronized retries.
   *
   * @defaultValue `200`
   */
  readonly backoffMs?: number;
  /**
   * Decides whether a given failure should be retried.
   *
   * @defaultValue Retries `kind: 'network'` and `kind: 'http'` with
   * `status >= 500`. Never retries a 4xx response or a validation failure —
   * retrying a client error or a response that failed schema validation
   * will not produce a different outcome.
   */
  readonly retryOn?: RetryPredicate;
}

/**
 * A pluggable response-validation function — bring your own schema library.
 *
 * @remarks
 * Intentionally not tied to Zod, Valibot, or any other library: this
 * package stays dependency-free. Throw (or return a rejected value your
 * adapter is written to reject) to signal a validation failure; the client
 * turns that into a `kind: 'validation'` {@link ApiErr}. See the README for
 * a Zod and a Valibot adapter example.
 *
 * @public
 */
export type ValidateFn = <T>(schema: unknown, data: unknown) => T;

/**
 * Per-request options, accepted by every client method and by
 * {@link EndpointCallOptions}.
 *
 * @public
 */
export interface RequestOptions {
  /** Merged over — never replaces — the client's `defaultHeaders`. */
  readonly headers?: Record<string, string>;
  /** Overrides the client's default timeout for this request only. */
  readonly timeoutMs?: number;
  /**
   * Overrides the client's default retry policy for this request only.
   * Pass `false` to disable retries entirely.
   */
  readonly retry?: false | RetryConfig;
  /**
   * A caller-supplied abort signal. Combined with the internal timeout
   * controller — whichever fires first aborts the request. This signal
   * never silently replaces the timeout.
   */
  readonly signal?: AbortSignal;
  /**
   * A schema to validate the response body against, using the client's
   * configured {@link ClientConfig.validate} adapter. Ignored if the client
   * has no `validate` adapter configured.
   */
  readonly schema?: unknown;
}

/** {@link ApiClient.endpoint}'s per-call options — {@link RequestOptions} plus a request body. */
export interface EndpointCallOptions extends RequestOptions {
  /** Request body for a write endpoint (`POST`/`PUT`/`PATCH`). */
  readonly body?: unknown;
}

/** Defines a reusable, pre-typed request via {@link ApiClient.endpoint}. */
export interface EndpointDefinition {
  /** The HTTP method this endpoint always uses. */
  readonly method: HttpMethod;
  /**
   * The request path, with `:name`-style segments for path parameters, e.g.
   * `/users/:id`. Interpolated from the `params` argument passed to the
   * returned function.
   */
  readonly path: string;
  /** Baked-in response schema for this endpoint — see {@link RequestOptions.schema}. */
  readonly schema?: unknown;
}

/** A callable endpoint built by {@link ApiClient.endpoint}. */
export type EndpointFn<T, E extends AppError = AppError> = (
  params?: Record<string, number | string>,
  options?: EndpointCallOptions,
) => Promise<ApiResult<T, E>>;

/** Configuration accepted by {@link createApiClient}. */
export interface ClientConfig {
  /** Prepended to every request path. A trailing slash is stripped. */
  readonly baseUrl: string;
  /** Sent on every request; per-call `headers` are merged over these. */
  readonly defaultHeaders?: Record<string, string>;
  /**
   * Default request timeout, in milliseconds.
   *
   * @defaultValue `10000`
   */
  readonly timeoutMs?: number;
  /** Default retry policy for every request. See {@link RetryConfig}. */
  readonly retry?: RetryConfig;
  /** Runs before each attempt. Mutate `headers`/`body`, e.g. to inject auth. */
  readonly onRequest?: (context: RequestContext) => Promise<RequestContext> | RequestContext;
  /** Runs after a response is received, before it is parsed. */
  readonly onResponse?: (context: ResponseContext) => Promise<ResponseContext> | ResponseContext;
  /** A pluggable response-validation adapter. See {@link ValidateFn}. */
  readonly validate?: ValidateFn;
}

/** The client built by {@link createApiClient}. */
export interface ApiClient {
  /** Issues a `GET` request. */
  get<T, E extends AppError = AppError>(
    path: string,
    options?: RequestOptions,
  ): Promise<ApiResult<T, E>>;
  /** Issues a `POST` request with a JSON-serialized `body`. */
  post<T, E extends AppError = AppError>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<ApiResult<T, E>>;
  /** Issues a `PUT` request with a JSON-serialized `body`. */
  put<T, E extends AppError = AppError>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<ApiResult<T, E>>;
  /** Issues a `PATCH` request with a JSON-serialized `body`. */
  patch<T, E extends AppError = AppError>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<ApiResult<T, E>>;
  /** Issues a `DELETE` request. */
  delete<T, E extends AppError = AppError>(
    path: string,
    options?: RequestOptions,
  ): Promise<ApiResult<T, E>>;
  /**
   * Builds a reusable, pre-typed request function, so call sites don't
   * repeat generics.
   *
   * @example
   * ```ts
   * const getUser = client.endpoint<User>({ method: 'GET', path: '/users/:id' });
   * const result = await getUser({ id: '123' });
   * ```
   */
  endpoint<T, E extends AppError = AppError>(definition: EndpointDefinition): EndpointFn<T, E>;
}
