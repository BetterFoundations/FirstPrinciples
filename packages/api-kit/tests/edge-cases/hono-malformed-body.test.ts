import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHonoServer } from '../integration/conformance/hono-server.js';
import type { ConformanceServer } from '../integration/conformance/conformance-suite.js';

/**
 * Hono-specific: `c.req.json()` throws a raw `SyntaxError` on a malformed
 * body, unlike Express/Fastify where a body-parser middleware sitting
 * ahead of the route already rejects it before `validateRequest` ever
 * runs. `extractHono`'s `body` case (`../../src/hono.ts`) is the one place
 * this package converts that into the same `ValidationError` shape every
 * other validation failure produces — covered here since it is Hono-only
 * behavior, out of scope for the shared conformance suite.
 */
describe('Hono validateRequest(body) with a malformed JSON body', () => {
  let server: ConformanceServer;

  beforeAll(async () => {
    server = await createHonoServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('produces a 400 ValidationError envelope, distinct from a schema-rejection failure', async () => {
    const res = await fetch(`${server.baseUrl}/validate/body`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not valid json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: unknown } };
    // Distinct from the schema-rejection code (REQUEST_VALIDATION_FAILED,
    // covered by the conformance suite's own body-validation-failure case)
    // — a request never even shaped like JSON never reaches `validate` at
    // all, so it earns its own, more specific code.
    expect(body.error.code).toBe('INVALID_JSON_BODY');
    expect(body.error.details).toEqual({ target: 'body' });
  });
});
