import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** What each adapter's server-builder hands back to the shared suite. */
export interface ConformanceServer {
  /** e.g. `http://127.0.0.1:54321` — no trailing slash. */
  readonly baseUrl: string;
  /** Stops the server and releases its port. */
  close(): Promise<void>;
}

/**
 * One conformance suite, run against all three framework adapters —
 * Express, Fastify, and Hono — each via its own real HTTP server on
 * loopback (see `express-server.ts`, `fastify-server.ts`,
 * `hono-server.ts`), never a framework-internal mock. Every assertion here
 * is about the wire response: status, content-type, and JSON body — never
 * about a framework-specific request-object detail — because that is
 * exactly the surface a drift between adapters would show up on.
 *
 * Each adapter's server implements the identical fixed route contract
 * documented inline below; the routes themselves live in each
 * `*-server.ts`, built directly from this package's public adapter
 * exports (`sendSuccess`, `sendError`, `validateRequest`, and the
 * framework's own error-registration entry point) — not from a second,
 * parallel implementation.
 */
export function runConformanceSuite(
  adapterName: string,
  start: () => Promise<ConformanceServer>,
): void {
  describe(`${adapterName} adapter conformance`, () => {
    let server: ConformanceServer;

    beforeAll(async () => {
      server = await start();
    });

    afterAll(async () => {
      await server.close();
    });

    it('GET /success → 200, application/json, SuccessEnvelope', async () => {
      const res = await fetch(`${server.baseUrl}/success`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      await expect(res.json()).resolves.toEqual({
        success: true,
        data: { id: '42', name: 'Ada' },
      });
    });

    it('GET /success/created → 201, SuccessEnvelope', async () => {
      const res = await fetch(`${server.baseUrl}/success/created`);
      expect(res.status).toBe(201);
      await expect(res.json()).resolves.toEqual({ success: true, data: { id: '1' } });
    });

    it('GET /error/not-found → 404, application/problem+json, exact ErrorEnvelope', async () => {
      const res = await fetch(`${server.baseUrl}/error/not-found`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      await expect(res.json()).resolves.toEqual({
        success: false,
        error: {
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          detail: 'No user 42',
          code: 'USER_NOT_FOUND',
        },
      });
    });

    it('GET /error/conflict → 409, error.details carried through', async () => {
      const res = await fetch(`${server.baseUrl}/error/conflict`);
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string; details: unknown } };
      expect(body.error.code).toBe('EMAIL_TAKEN');
      expect(body.error.details).toEqual({ field: 'email' });
    });

    it('GET /error/unknown → 500, generic body, never the original message', async () => {
      const res = await fetch(`${server.baseUrl}/error/unknown`);
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string; detail: string } };
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.detail).not.toContain('super-secret-internal-detail');
    });

    it('GET /error/typed → type built from a per-call typeBaseUrl', async () => {
      const res = await fetch(`${server.baseUrl}/error/typed`);
      const body = (await res.json()) as { error: { type: string } };
      expect(body.error.type).toBe('https://errors.example.com/user-not-found');
    });

    it('POST /validate/body → 200, validated body passed through', async () => {
      const res = await fetch(`${server.baseUrl}/validate/body`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ada' }),
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ success: true, data: { name: 'Ada' } });
    });

    it('POST /validate/body with a missing field → 400, target: body', async () => {
      const res = await fetch(`${server.baseUrl}/validate/body`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; details: unknown } };
      expect(body.error.code).toBe('REQUEST_VALIDATION_FAILED');
      expect(body.error.details).toEqual({ target: 'body' });
    });

    it('GET /validate/query → validates the query string both ways', async () => {
      const ok = await fetch(`${server.baseUrl}/validate/query?name=Ada`);
      expect(ok.status).toBe(200);
      await expect(ok.json()).resolves.toEqual({ success: true, data: { name: 'Ada' } });

      const failing = await fetch(`${server.baseUrl}/validate/query`);
      expect(failing.status).toBe(400);
      const body = (await failing.json()) as { error: { details: unknown } };
      expect(body.error.details).toEqual({ target: 'query' });
    });

    it('GET /validate/params/:id → validates route params', async () => {
      const res = await fetch(`${server.baseUrl}/validate/params/abc-123`);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ success: true, data: { id: 'abc-123' } });
    });

    it('GET /validate/params-invalid/:id → 400, target: params', async () => {
      const res = await fetch(`${server.baseUrl}/validate/params-invalid/abc-123`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { details: unknown } };
      expect(body.error.details).toEqual({ target: 'params' });
    });

    it('GET /validate/headers → validates request headers both ways', async () => {
      const ok = await fetch(`${server.baseUrl}/validate/headers`, {
        headers: { 'x-api-key': 'secret-key' },
      });
      expect(ok.status).toBe(200);
      await expect(ok.json()).resolves.toEqual({
        success: true,
        data: { 'x-api-key': 'secret-key' },
      });

      const failing = await fetch(`${server.baseUrl}/validate/headers`);
      expect(failing.status).toBe(400);
      const body = (await failing.json()) as { error: { details: unknown } };
      expect(body.error.details).toEqual({ target: 'headers' });
    });
  });
}
