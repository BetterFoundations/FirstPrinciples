import { ConflictError, NotFoundError } from '@firstprinciples/core';
import Fastify from 'fastify';
import { registerApiKit, sendError, sendSuccess, validateRequest } from '../../../src/fastify.js';
import type { ConformanceServer } from './conformance-suite.js';
import { requireFields } from './validate-fn.js';

/** Builds the fixed conformance route contract on a real Fastify app, listening on an ephemeral loopback port. */
export async function createFastifyServer(): Promise<ConformanceServer> {
  const app = Fastify();
  registerApiKit(app);

  app.get('/success', async (_request, reply) => {
    sendSuccess(reply, { id: '42', name: 'Ada' });
  });
  app.get('/success/created', async (_request, reply) => {
    sendSuccess(reply, { id: '1' }, 201);
  });

  app.get('/error/not-found', async () => {
    throw new NotFoundError('No user 42', { code: 'USER_NOT_FOUND' });
  });
  app.get('/error/conflict', async () => {
    throw new ConflictError('Email taken', { code: 'EMAIL_TAKEN', details: { field: 'email' } });
  });
  app.get('/error/unknown', async () => {
    throw new Error('super-secret-internal-detail: db password xyz');
  });
  app.get('/error/typed', async (_request, reply) => {
    sendError(reply, new NotFoundError('No user 42', { code: 'USER_NOT_FOUND' }), {
      typeBaseUrl: 'https://errors.example.com',
    });
  });

  app.post(
    '/validate/body',
    { preHandler: validateRequest({ target: 'body', schema: ['name'], validate: requireFields }) },
    async (request, reply) => {
      sendSuccess(reply, request.valid?.body);
    },
  );
  app.get(
    '/validate/query',
    { preHandler: validateRequest({ target: 'query', schema: ['name'], validate: requireFields }) },
    async (request, reply) => {
      sendSuccess(reply, request.valid?.query);
    },
  );
  app.get(
    '/validate/params/:id',
    { preHandler: validateRequest({ target: 'params', schema: ['id'], validate: requireFields }) },
    async (request, reply) => {
      sendSuccess(reply, request.valid?.params);
    },
  );
  app.get(
    '/validate/params-invalid/:id',
    {
      preHandler: validateRequest({ target: 'params', schema: ['name'], validate: requireFields }),
    },
    async (request, reply) => {
      sendSuccess(reply, request.valid?.params);
    },
  );
  app.get(
    '/validate/headers',
    {
      preHandler: validateRequest({
        target: 'headers',
        schema: ['x-api-key'],
        validate: requireFields,
      }),
    },
    async (request, reply) => {
      sendSuccess(reply, request.valid?.headers);
    },
  );

  const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  return {
    baseUrl,
    close: () => app.close(),
  };
}
