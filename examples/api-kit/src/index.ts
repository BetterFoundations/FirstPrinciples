// Runnable usage example for \@firstprinciples/api-kit (Express adapter).
//
// Run with: pnpm --filter examples-api-kit start
//
// Four scenarios against a real Express server on loopback: a success
// envelope; a thrown NotFoundError mapped to an RFC 7807 problem-details
// error envelope; request validation, both passing and failing, without
// importing any schema library; and a raw (non-AppError) throw normalized
// without leaking its own message.
import express from 'express';
import { ConflictError, NotFoundError } from '@firstprinciples/core';
import { apiKitErrorHandler, sendSuccess, validateRequest } from '@firstprinciples/api-kit/express';
import type { ValidateFn } from '@firstprinciples/api-kit';

interface User {
  id: string;
  name: string;
}

const users = new Map<string, User>([['1', { id: '1', name: 'Ada Lovelace' }]]);

// A hand-rolled validator — proves validateRequest never assumes Zod,
// Valibot, or any other specific schema library.
const requireName: ValidateFn = (_schema, data) => {
  if (typeof data !== 'object' || data === null || !('name' in data) || !data.name) {
    throw new Error('name is required');
  }
  return data as { name: string };
};

const app = express();
app.use(express.json());

app.get('/users/:id', (req, res) => {
  const user = users.get(req.params.id);
  if (!user) throw new NotFoundError(`No user ${req.params.id}`, { code: 'USER_NOT_FOUND' });
  sendSuccess(res, user);
});

app.post(
  '/users',
  validateRequest({ target: 'body', schema: {}, validate: requireName }),
  (_req, res) => {
    const body = (res.locals['valid'] as { body: { name: string } }).body;
    if (users.has(body.name)) {
      throw new ConflictError('Name already taken', {
        code: 'NAME_TAKEN',
        details: { field: 'name' },
      });
    }
    const id = String(users.size + 1);
    const user: User = { id, name: body.name };
    users.set(id, user);
    sendSuccess(res, user, 201);
  },
);

app.get('/boom', () => {
  throw new Error('connection refused at 10.0.0.5:5432, user=admin, password=hunter2');
});

app.use(apiKitErrorHandler());

const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
const baseUrl = `http://127.0.0.1:${String(address.port)}`;

console.log('--- 1. a success envelope ---\n');

const ok = await fetch(`${baseUrl}/users/1`);
console.log(JSON.stringify(await ok.json(), null, 2));

console.log('\n--- 2. a thrown NotFoundError → RFC 7807 problem-details ---\n');

const notFound = await fetch(`${baseUrl}/users/999`);
console.log(`status: ${notFound.status}, content-type: ${notFound.headers.get('content-type')}`);
console.log(JSON.stringify(await notFound.json(), null, 2));

console.log('\n--- 3. request validation, passing then failing ---\n');

const created = await fetch(`${baseUrl}/users`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Grace Hopper' }),
});
console.log(`created: ${created.status}`, JSON.stringify(await created.json()));

const invalid = await fetch(`${baseUrl}/users`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({}),
});
console.log(`validation failure: ${invalid.status}`, JSON.stringify(await invalid.json()));

console.log('\n--- 4. an unexpected throw is normalized, never leaking its message ---\n');

const boom = await fetch(`${baseUrl}/boom`);
const boomBody = (await boom.json()) as { error: { code: string; detail: string } };
console.log(
  `status: ${boom.status}, code: ${boomBody.error.code}, detail: "${boomBody.error.detail}"`,
);

server.close();
