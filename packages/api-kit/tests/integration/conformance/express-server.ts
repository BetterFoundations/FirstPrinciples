import { ConflictError, NotFoundError } from '@firstprinciples/core';
import express from 'express';
import {
  apiKitErrorHandler,
  sendError,
  sendSuccess,
  validateRequest,
} from '../../../src/express.js';
import type { ConformanceServer } from './conformance-suite.js';
import { requireFields } from './validate-fn.js';

/** Builds the fixed conformance route contract on a real Express app, listening on an ephemeral loopback port. */
export function createExpressServer(): Promise<ConformanceServer> {
  const app = express();
  app.use(express.json());

  app.get('/success', (_req, res) => {
    sendSuccess(res, { id: '42', name: 'Ada' });
  });
  app.get('/success/created', (_req, res) => {
    sendSuccess(res, { id: '1' }, 201);
  });

  app.get('/error/not-found', () => {
    throw new NotFoundError('No user 42', { code: 'USER_NOT_FOUND' });
  });
  app.get('/error/conflict', () => {
    throw new ConflictError('Email taken', { code: 'EMAIL_TAKEN', details: { field: 'email' } });
  });
  app.get('/error/unknown', () => {
    throw new Error('super-secret-internal-detail: db password xyz');
  });
  app.get('/error/typed', (_req, res) => {
    sendError(res, new NotFoundError('No user 42', { code: 'USER_NOT_FOUND' }), {
      typeBaseUrl: 'https://errors.example.com',
    });
  });

  app.post(
    '/validate/body',
    validateRequest({ target: 'body', schema: ['name'], validate: requireFields }),
    (_req, res) => {
      sendSuccess(res, (res.locals['valid'] as { body: unknown }).body);
    },
  );
  app.get(
    '/validate/query',
    validateRequest({ target: 'query', schema: ['name'], validate: requireFields }),
    (_req, res) => {
      sendSuccess(res, (res.locals['valid'] as { query: unknown }).query);
    },
  );
  app.get(
    '/validate/params/:id',
    validateRequest({ target: 'params', schema: ['id'], validate: requireFields }),
    (_req, res) => {
      sendSuccess(res, (res.locals['valid'] as { params: unknown }).params);
    },
  );
  app.get(
    '/validate/params-invalid/:id',
    validateRequest({ target: 'params', schema: ['name'], validate: requireFields }),
    (_req, res) => {
      sendSuccess(res, (res.locals['valid'] as { params: unknown }).params);
    },
  );
  app.get(
    '/validate/headers',
    validateRequest({ target: 'headers', schema: ['x-api-key'], validate: requireFields }),
    (_req, res) => {
      sendSuccess(res, (res.locals['valid'] as { headers: unknown }).headers);
    },
  );

  app.use(apiKitErrorHandler());

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('expected a bound TCP address');
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}
