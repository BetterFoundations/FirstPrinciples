import express, { type ErrorRequestHandler } from 'express';
import {
  createAccessControl,
  PermissionDeniedError,
  type AccessControl,
  type Decision,
} from '../../../src/index.js';
import { createExpressGuard, type PermissionGrant } from '../../../src/express.js';
import { sharedPolicy } from '../../shared/policy.js';
import { decisionTable } from '../../shared/decision-table.js';
import type { ConformanceServer } from './conformance-suite.js';
import { principalFailure, resourceFailure, routePrincipal, stashResource } from './routes.js';

/** Maps a denial to 403 the way a real app would; anything else is a 500. */
const errorHandler: ErrorRequestHandler =
  // Express recognizes error middleware by arity, so `_next` must stay declared.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (error, _req, res, _next) => {
    if (error instanceof PermissionDeniedError) {
      res.status(error.httpStatus).json({ error: error.toJSON() });
      return;
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
  };

/** Builds the fixed conformance route contract on a real Express app. */
export function createExpressServer(): Promise<ConformanceServer> {
  const app = express();
  const ac: AccessControl = createAccessControl(sharedPolicy);
  const denials: Decision[] = [];

  const guardFor = (principal: Parameters<AccessControl['for']>[0]) =>
    createExpressGuard(ac, {
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
      (_req, res) => {
        res.json({ reached: true });
      },
    );
  });

  app.get(
    '/stash',
    guardFor(routePrincipal)('update', 'post', { getResource: () => stashResource }),
    (_req, res) => {
      const grant = res.locals['permission'] as PermissionGrant;
      res.json({ reached: true, resourceId: (grant.resource as { id: string }).id });
    },
  );

  app.get(
    '/missing-resource',
    guardFor(routePrincipal)('update', 'post', { getResource: () => null }),
    (_req, res) => {
      res.json({ reached: true });
    },
  );

  app.get(
    '/throws-principal',
    createExpressGuard(ac, {
      getPrincipal: () => {
        throw principalFailure;
      },
    })('read', 'post'),
    (_req, res) => {
      res.json({ reached: true });
    },
  );

  app.get(
    '/throws-resource',
    guardFor(routePrincipal)('update', 'post', {
      getResource: () => {
        throw resourceFailure;
      },
    }),
    (_req, res) => {
      res.json({ reached: true });
    },
  );

  app.use(errorHandler);

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        denials,
        close: () => new Promise((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}
