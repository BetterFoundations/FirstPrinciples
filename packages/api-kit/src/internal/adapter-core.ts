import { toErrorEnvelope, toSuccessEnvelope } from '../envelope.js';
import type { ApiEnvelope } from '../envelope.js';
import type { ProblemDetailsOptions } from '../problem-details.js';
import type { ValidationTarget } from '../validation.js';

/**
 * The single place every adapter's response — success or error — is
 * actually built. `express.ts`, `fastify.ts`, and `hono.ts` each translate
 * a framework's request/response objects into a call here and write back
 * exactly what it returns; none of them re-derive status, body, or
 * content-type on their own. This is what makes drift between the three
 * structurally impossible rather than merely tested against: there is
 * only one function that decides what a response looks like.
 */

/** Content-type every `@firstprinciples/api-kit` success response is sent with. */
export const JSON_CONTENT_TYPE = 'application/json';
/** Content-type every `@firstprinciples/api-kit` error response is sent with, per RFC 7807 §3. */
export const PROBLEM_JSON_CONTENT_TYPE = 'application/problem+json';

/** What an adapter needs to write back to its framework's response object. */
export interface AdapterResponse {
  readonly status: number;
  readonly body: ApiEnvelope<unknown>;
  readonly contentType: string;
}

/** Builds the response for a successful operation. Shared by every adapter's `sendSuccess`. */
export function buildSuccessResponse(data: unknown, status = 200): AdapterResponse {
  return { status, body: toSuccessEnvelope(data), contentType: JSON_CONTENT_TYPE };
}

/**
 * Builds the response for a failed operation. Shared by every adapter's
 * `sendError` and its registered error handler — the `status` is read back
 * off the mapped problem details, not passed in separately, so it can
 * never disagree with the body it is sent alongside.
 */
export function buildErrorResponse(
  error: unknown,
  options?: ProblemDetailsOptions,
): AdapterResponse {
  const envelope = toErrorEnvelope(error, options);
  return { status: envelope.error.status, body: envelope, contentType: PROBLEM_JSON_CONTENT_TYPE };
}

/**
 * The subset of Express's `Request` and Fastify's `FastifyRequest` shapes
 * {@link extractTarget} needs — both frameworks use these exact property
 * names, so one extractor serves both adapters (Hono's request API is
 * shaped too differently — method calls, an async `body` — to share this
 * one; see `hono.ts`'s own extractor).
 */
export interface ExtractableRequest {
  readonly body?: unknown;
  readonly headers?: unknown;
  readonly params?: unknown;
  readonly query?: unknown;
}

/** Reads the part of `req` named by `target`. Shared by the Express and Fastify adapters. */
export function extractTarget(req: ExtractableRequest, target: ValidationTarget): unknown {
  switch (target) {
    case 'body':
      return req.body;
    case 'headers':
      return req.headers;
    case 'params':
      return req.params;
    case 'query':
      return req.query;
  }
}

/**
 * Stores a validated value under `target` in a per-request bag (Express:
 * `res.locals.valid`; Fastify: a decorated `request.valid`; Hono: a
 * `'valid'` context variable) — the one place across all three adapters
 * that writes into that bag, so its shape can never drift between them.
 */
export function storeValid(
  bag: Partial<Record<ValidationTarget, unknown>>,
  target: ValidationTarget,
  value: unknown,
): void {
  // `target` is always one of the four ValidationTarget literals, set by
  // this package's own code — never caller-controlled input, so there is
  // no injection sink here.
  // eslint-disable-next-line security/detect-object-injection
  bag[target] = value;
}
