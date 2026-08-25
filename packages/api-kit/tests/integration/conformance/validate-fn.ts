import type { ValidateFn } from '../../../src/validation.js';

/**
 * A deliberately hand-rolled validation adapter — no schema library is
 * imported anywhere in this test suite. That is itself part of what the
 * conformance suite proves: `validateRequest` never assumes Zod, Valibot,
 * or any other specific library, across any of the three adapters.
 *
 * `schema` here is just `readonly string[]`: the field names required to
 * be present. Picks and returns only those fields (never the whole raw
 * object) so the expected response body is identical across Express,
 * Fastify, and Hono regardless of what else a given target happens to
 * carry (extra headers, for instance).
 */
export const requireFields: ValidateFn = <T>(schema: unknown, data: unknown): T => {
  const fields = schema as readonly string[];
  if (typeof data !== 'object' || data === null) {
    throw new TypeError('expected an object to validate');
  }
  const record = data as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    // `fields` is test-authored schema data (a fixed array literal at each
    // call site in this suite), never request-controlled input.
    // eslint-disable-next-line security/detect-object-injection
    const value = record[field];
    if (value === undefined) throw new Error(`missing required field: ${field}`);
    // eslint-disable-next-line security/detect-object-injection
    picked[field] = value;
  }
  return picked as T;
};
