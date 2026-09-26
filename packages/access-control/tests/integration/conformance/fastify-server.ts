import Fastify from 'fastify';
import {
  createAccessControl,
  PermissionDeniedError,
  type AccessControl,
  type Decision,
} from '../../../src/index.js';
import { createFastifyGuard, registerAccessControl } from '../../../src/fastify.js';
import { sharedPolicy } from '../../shared/policy.js';
import { decisionTable } from '../../shared/decision-table.js';
import type { ConformanceServer } from './conformance-suite.js';
import { principalFailure, resourceFailure, routePrincipal, stashResource } from './routes.js';

/** Builds the fixed conformance route contract on a real Fastify app. */
export async function createFastifyServer(): Promise<ConformanceServer> {
  const app = Fastify();
  registerAccessControl(app);

  const ac: AccessControl = createAccessControl(sharedPolicy);
  const denials: Decision[] = [];

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof PermissionDeniedError) {
      void reply.status(error.httpStatus).send({ error: error.toJSON() });
      return;
    }
    void reply.status(500).send({ error: { code: 'INTERNAL_ERROR' } });
  });

  const guardFor = (principal: Parameters<AccessControl['for']>[0]) =>
    createFastifyGuard(ac, {
      getPrincipal: () => principal,
      onDeny: ({ decision }) => denials.push(decision),
    });

  decisionTable.forEach((row, index) => {
    app.get(
      `/case/${index}`,
      {
        preHandler: guardFor(row.principal)(row.action, row.subject, {
          getResource: () => row.resource,
          getEnv: () => row.env,
        }),
      },
      () => ({ reached: true }),
    );
  });

  app.get(
    '/stash',
    {
      preHandler: guardFor(routePrincipal)('update', 'post', { getResource: () => stashResource }),
    },
    (request) => ({
      reached: true,
      resourceId: (request.permission?.resource as { id: string }).id,
    }),
  );

  app.get(
    '/missing-resource',
    { preHandler: guardFor(routePrincipal)('update', 'post', { getResource: () => null }) },
    () => ({ reached: true }),
  );

  app.get(
    '/throws-principal',
    {
      preHandler: createFastifyGuard(ac, {
        getPrincipal: () => {
          throw principalFailure;
        },
      })('read', 'post'),
    },
    () => ({ reached: true }),
  );

  app.get(
    '/throws-resource',
    {
      preHandler: guardFor(routePrincipal)('update', 'post', {
        getResource: () => {
          throw resourceFailure;
        },
      }),
    },
    () => ({ reached: true }),
  );

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    denials,
    close: () => app.close(),
  };
}
