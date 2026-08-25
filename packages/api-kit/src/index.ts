/**
 * `@firstprinciples/api-kit` — backend API response conventions: a
 * standardized success/error envelope, RFC 7807 problem-details formatting
 * of `@firstprinciples/core` errors, and schema-library-agnostic request
 * validation.
 *
 * This entry point is framework-free — importing it never pulls in
 * Express, Fastify, or Hono. Each framework's integration is a separate
 * subpath (`@firstprinciples/api-kit/express`,
 * `@firstprinciples/api-kit/fastify`, `@firstprinciples/api-kit/hono`),
 * built on top of exactly the exports here, so installing this package
 * never forces one framework on a consumer using another.
 *
 * @packageDocumentation
 */

export { envelopeFromResult, toErrorEnvelope, toSuccessEnvelope } from './envelope.js';
export type { ApiEnvelope, ErrorEnvelope, SuccessEnvelope } from './envelope.js';

export { toProblemDetails } from './problem-details.js';
export type { ProblemDetails, ProblemDetailsOptions } from './problem-details.js';

export { runValidation } from './validation.js';
export type { ValidateFn, ValidationConfig, ValidationTarget } from './validation.js';
