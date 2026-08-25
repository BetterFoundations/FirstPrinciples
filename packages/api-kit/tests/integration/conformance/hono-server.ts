import { serve } from '@hono/node-server';
import { ConflictError, NotFoundError } from '@firstprinciples/core';
import { Hono } from 'hono';
import { apiKitErrorHandler, sendError, sendSuccess, validateRequest } from '../../../src/hono.js';
import type { ConformanceServer } from './conformance-suite.js';
import { requireFields } from './validate-fn.js';

/** Builds the fixed conformance route contract on a real Hono app, listening on an ephemeral loopback port. */
export function createHonoServer(): Promise<ConformanceServer> {
  const app = new Hono();
  app.onError(apiKitErrorHandler());

  app.get('/success', (c) => sendSuccess(c, { id: '42', name: 'Ada' }));
  app.get('/success/created', (c) => sendSuccess(c, { id: '1' }, 201));

  app.get('/error/not-found', () => {
    throw new NotFoundError('No user 42', { code: 'USER_NOT_FOUND' });
  });
  app.get('/error/conflict', () => {
    throw new ConflictError('Email taken', { code: 'EMAIL_TAKEN', details: { field: 'email' } });
  });
  app.get('/error/unknown', () => {
    throw new Error('super-secret-internal-detail: db password xyz');
  });
  app.get('/error/typed', (c) =>
    sendError(c, new NotFoundError('No user 42', { code: 'USER_NOT_FOUND' }), {
      typeBaseUrl: 'https://errors.example.com',
    }),
  );

  app.post(
    '/validate/body',
    validateRequest({ target: 'body', schema: ['name'], validate: requireFields }),
    (c) => sendSuccess(c, c.get('valid')?.body),
  );
  app.get(
    '/validate/query',
    validateRequest({ target: 'query', schema: ['name'], validate: requireFields }),
    (c) => sendSuccess(c, c.get('valid')?.query),
  );
  app.get(
    '/validate/params/:id',
    validateRequest({ target: 'params', schema: ['id'], validate: requireFields }),
    (c) => sendSuccess(c, c.get('valid')?.params),
  );
  app.get(
    '/validate/params-invalid/:id',
    validateRequest({ target: 'params', schema: ['name'], validate: requireFields }),
    (c) => sendSuccess(c, c.get('valid')?.params),
  );
  app.get(
    '/validate/headers',
    validateRequest({ target: 'headers', schema: ['x-api-key'], validate: requireFields }),
    (c) => sendSuccess(c, c.get('valid')?.headers),
  );

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      resolve({
        baseUrl: `http://127.0.0.1:${info.port}`,
        close: () => new Promise((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}
