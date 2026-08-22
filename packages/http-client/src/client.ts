import { type AppError, ValidationError } from '@firstprinciples/core';
import { parseResponseBody, serializeRequestBody } from './internal/body.js';
import { toHttpError, toNetworkError } from './internal/errors.js';
import { interpolatePath, joinUrl } from './internal/path.js';
import {
  type ResolvedRetryConfig,
  executeWithRetry,
  resolveRetryConfig,
} from './internal/retry.js';
import { createCombinedSignal } from './internal/signal.js';
import type {
  ApiClient,
  ApiResult,
  ClientConfig,
  EndpointDefinition,
  EndpointFn,
  HttpMethod,
  RequestContext,
  RequestOptions,
  ResponseContext,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;

function mergeHeaders(...sources: (Record<string, string> | undefined)[]): Record<string, string> {
  // `key` comes from caller-supplied header objects (defaultHeaders,
  // per-call headers), so a header literally named `__proto__` is
  // plausible — a plain `{}` accumulator would hit the special prototype
  // setter instead of creating an own property. Mirrors the same fix in
  // @firstprinciples/logger's redaction accumulator.
  const merged: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      // eslint-disable-next-line security/detect-object-injection -- see the Object.create(null) comment above
      merged[key] = value;
    }
  }
  return merged;
}

function hasContentTypeHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
}

/**
 * Builds a typed API client.
 *
 * @remarks
 * See the module documentation ({@link index}) for the full recipe set.
 * Nothing this client's methods return ever throws for an expected API
 * outcome — a network failure, a typed HTTP error, and a validation
 * failure are all distinct {@link ApiResult} variants (`kind: 'network'` /
 * `'http'` / `'validation'`), never a rejected promise.
 *
 * @public
 */
export function createApiClient(config: ClientConfig): ApiClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultRetryConfig: ResolvedRetryConfig = resolveRetryConfig(config.retry);

  async function performRequest<T, E extends AppError = AppError>(
    method: HttpMethod,
    path: string,
    body: unknown,
    options: RequestOptions = {},
  ): Promise<ApiResult<T, E>> {
    const url = joinUrl(baseUrl, path);
    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    const retryConfig = resolveRetryConfig(options.retry, defaultRetryConfig);
    const serializedBody = serializeRequestBody(body);

    const attempt = async (): Promise<ApiResult<T, E>> => {
      const { signal, cleanup } = createCombinedSignal(timeoutMs, options.signal);
      try {
        const headers = mergeHeaders(config.defaultHeaders, options.headers);
        if (serializedBody !== undefined && !hasContentTypeHeader(headers)) {
          headers['content-type'] = 'application/json';
        }

        let context: RequestContext = { url, method, headers, body: serializedBody, signal };
        if (config.onRequest) context = await config.onRequest(context);

        let rawResponse: Response;
        try {
          rawResponse = await fetch(context.url, {
            method: context.method,
            headers: context.headers,
            signal: context.signal,
            ...(context.body === undefined ? {} : { body: context.body }),
          });
        } catch (cause) {
          const error = toNetworkError(cause, context.url, signal.aborted) as unknown as E;
          return { ok: false, error, status: undefined, kind: 'network' };
        }

        let responseContext: ResponseContext = { request: context, response: rawResponse };
        if (config.onResponse) responseContext = await config.onResponse(responseContext);
        const response = responseContext.response;

        if (!response.ok) {
          const body = await parseResponseBody(response);
          const error = toHttpError(response, body) as unknown as E;
          return { ok: false, error, status: response.status, kind: 'http' };
        }

        const parsedBody = await parseResponseBody(response);
        if (options.schema === undefined || !config.validate) {
          return { ok: true, value: parsedBody as T, status: response.status };
        }

        try {
          const validated = config.validate<T>(options.schema, parsedBody);
          return { ok: true, value: validated, status: response.status };
        } catch (cause) {
          const error = new ValidationError('Response failed schema validation', {
            code: 'RESPONSE_VALIDATION_FAILED',
            cause,
            details: { status: response.status },
          }) as unknown as E;
          return { ok: false, error, status: response.status, kind: 'validation' };
        }
      } finally {
        cleanup();
      }
    };

    return executeWithRetry(attempt, retryConfig);
  }

  function endpoint<T, E extends AppError = AppError>(
    definition: EndpointDefinition,
  ): EndpointFn<T, E> {
    return async (params, options) => {
      const path = interpolatePath(definition.path, params);
      const schema = options?.schema ?? definition.schema;
      return performRequest<T, E>(definition.method, path, options?.body, { ...options, schema });
    };
  }

  return {
    get: (path, options) => performRequest('GET', path, undefined, options),
    post: (path, body, options) => performRequest('POST', path, body, options),
    put: (path, body, options) => performRequest('PUT', path, body, options),
    patch: (path, body, options) => performRequest('PATCH', path, body, options),
    delete: (path, options) => performRequest('DELETE', path, undefined, options),
    endpoint,
  };
}
