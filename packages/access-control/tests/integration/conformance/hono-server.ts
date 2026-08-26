import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import {
  createAccessControl,
  PermissionDeniedError,
  type AccessControl,
  type Decision,
} from '../../../src/index.js';
import { createHonoGuard } from '../../../src/hono.js';
import { sharedPolicy } from '../../shared/policy.js';
import { decisionTable } from '../../shared/decision-table.js';
import type { ConformanceServer } from './conformance-suite.js';
import { principalFailure, resourceFailure, routePrincipal, stashResource } from './routes.js';

/** Builds the fixed conformance route contract on a real Hono app. */
export function createHonoServer(): Promise<ConformanceServer> {
  const app = new Hono();
  const ac: AccessControl = createAccessControl(sharedPolicy);
  const denials: Decision[] = [];

  app.onError((error, c) => {
    if (error instanceof PermissionDeniedError) {
      return c.json({ error: error.toJSON() }, 403);
    }
    return c.json({ error: { code: 'INTERNAL_ERROR' } }, 500);
  });

  const guardFor = (principal: Parameters<AccessControl['for']>[0]) =>
    createHonoGuard(ac, {
      getPrincipal: () => principal,
      onDeny: ({ decision }) => denials.push(decision),
    });

  decisionTable.forEach((row, index) => {
    app.get(
      `/case/${index}`,
      guardFor(row.principal)(row.action, row.subject, {
        getResource: () => row.resource,
        getEnv: () => row.env,
      }),
      (c) => c.json({ reached: true }),
    );
  });

  app.get(
    '/stash',
    guardFor(routePrincipal)('update', 'post', { getResource: () => stashResource }),
    (c) =>
      c.json({
        reached: true,
        resourceId: (c.get('permission').resource as { id: string }).id,
      }),
  );

  app.get(
    '/missing-resource',
    guardFor(routePrincipal)('update', 'post', { getResource: () => null }),
    (c) => c.json({ reached: true }),
  );

  app.get(
    '/throws-principal',
    createHonoGuard(ac, {
      getPrincipal: () => {
        throw principalFailure;
      },
    })('read', 'post'),
    (c) => c.json({ reached: true }),
  );

  app.get(
    '/throws-resource',
    guardFor(routePrincipal)('update', 'post', {
      getResource: () => {
        throw resourceFailure;
      },
    }),
    (c) => c.json({ reached: true }),
  );

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      resolve({
        baseUrl: `http://127.0.0.1:${info.port}`,
        denials,
        close: () => new Promise((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}
