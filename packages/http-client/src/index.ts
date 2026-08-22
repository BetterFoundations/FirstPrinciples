/**
 * `@firstprinciples/http-client` — a typed `fetch` wrapper: every request
 * returns a discriminated-union {@link ApiResult}, never a thrown
 * exception, and network failures are a distinct result variant from typed
 * HTTP error responses.
 *
 * @example Basic request
 * ```ts
 * import { createApiClient } from '@firstprinciples/http-client';
 * import { isErr } from '@firstprinciples/core';
 *
 * interface User { id: string; name: string }
 *
 * const client = createApiClient({ baseUrl: 'https://api.example.com' });
 * const result = await client.get<User>('/users/123');
 *
 * if (isErr(result)) {
 *   // result.kind is 'network' | 'http' | 'validation'
 *   console.error(result.kind, result.error.message);
 * } else {
 *   console.log(result.value.name);
 * }
 * ```
 *
 * @example Endpoint-definition pattern
 * ```ts
 * const getUser = client.endpoint<User>({ method: 'GET', path: '/users/:id' });
 * const result = await getUser({ id: '123' });
 * ```
 *
 * @packageDocumentation
 */

export { createApiClient } from './client.js';
export type {
  ApiClient,
  ApiErr,
  ApiOk,
  ApiResult,
  ClientConfig,
  EndpointCallOptions,
  EndpointDefinition,
  EndpointFn,
  HttpMethod,
  RequestContext,
  RequestOptions,
  ResponseContext,
  RetryConfig,
  RetryPredicate,
  ValidateFn,
} from './types.js';
