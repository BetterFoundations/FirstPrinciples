import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Decision } from '../../../src/index.js';
import { decisionTable } from '../../shared/decision-table.js';

/** What each adapter's server-builder hands back to the shared suite. */
export interface ConformanceServer {
  /** e.g. `http://127.0.0.1:54321` — no trailing slash. */
  readonly baseUrl: string;
  /** Every decision the guard's `onDeny` hook saw, in order. */
  readonly denials: Decision[];
  /** Stops the server and releases its port. */
  close(): Promise<void>;
}

/**
 * One conformance suite, run against all three framework adapters, each
 * on a real HTTP server on loopback.
 *
 * The bulk of it is **the shared decision table, driven over the wire**:
 * every row becomes a request to a route guarded by that adapter's real
 * `requirePermission`, and an allowed row must reach the handler while a
 * denied row must not. That is what makes "the same rule set produces
 * identical decisions on client and server" checkable rather than
 * asserted — the rows are the same rows the engine suite and the React
 * suite run, so a guard that drifted from the engine fails here, and
 * only here.
 *
 * The remaining cases pin the failure paths, which is where an
 * authorization middleware is most likely to fail open: a principal
 * lookup that throws, a resource that will not load, a route that
 * assumes the guard ran.
 */
export function runGuardConformanceSuite(
  adapterName: string,
  start: () => Promise<ConformanceServer>,
): void {
  describe(`${adapterName} guard conformance`, () => {
    let server: ConformanceServer;

    beforeAll(async () => {
      server = await start();
    });

    afterAll(async () => {
      await server.close();
    });

    describe('the shared decision table, over HTTP', () => {
      decisionTable.forEach((row, index) => {
        it(`${row.name} → ${row.allowed ? '200' : '403'}`, async () => {
          const response = await fetch(`${server.baseUrl}/case/${index}`);
          expect(response.status).toBe(row.allowed ? 200 : 403);

          if (row.allowed) {
            await expect(response.json()).resolves.toMatchObject({ reached: true });
            return;
          }
          const body = (await response.json()) as { error: { code: string; details: unknown } };
          expect(body.error.code).toBe('PERMISSION_DENIED');
          // Exactly what the caller already told us, and nothing else —
          // no rule id, no reason. See PermissionDeniedError.
          expect(body.error.details).toEqual({ action: row.action, subject: row.subject });
          // The reason and the deciding rule stay server-side.
          expect(body.error).not.toHaveProperty('reason');
          expect(body.error).not.toHaveProperty('ruleId');
        });
      });
    });

    it('leaves the loaded resource on the request for the handler', async () => {
      const response = await fetch(`${server.baseUrl}/stash`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ reached: true, resourceId: 'p1' });
    });

    it('denies rather than 404s when the resource does not exist', async () => {
      // A 404 here would answer "no such record" to someone who was not
      // allowed to look. The guard denies instead.
      const response = await fetch(`${server.baseUrl}/missing-resource`);
      expect(response.status).toBe(403);
    });

    it('fails the request, never allows it, when getPrincipal throws', async () => {
      const response = await fetch(`${server.baseUrl}/throws-principal`);
      expect(response.status).toBe(500);
      await expect(response.text()).resolves.not.toContain('reached');
    });

    it('fails the request, never allows it, when getResource throws', async () => {
      const response = await fetch(`${server.baseUrl}/throws-resource`);
      expect(response.status).toBe(500);
      await expect(response.text()).resolves.not.toContain('reached');
    });

    it('reports each denial to onDeny with the reason the client never sees', async () => {
      const before = server.denials.length;
      await fetch(`${server.baseUrl}/missing-resource`);
      const recorded = server.denials.slice(before);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.allowed).toBe(false);
      // Not `no_matching_rule`: the policy's lock rule could not be
      // ruled out without the post, so the denial is the unresolved one.
      expect(recorded[0]?.reason).toBe('unresolved_deny');
      expect(recorded[0]?.action).toBe('update');
    });
  });
}
