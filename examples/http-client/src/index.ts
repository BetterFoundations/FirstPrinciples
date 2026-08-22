// Runnable usage example for \@firstprinciples/http-client.
//
// Run with: pnpm --filter examples-http-client start
//
// Four scenarios: the endpoint-definition pattern against a real (local)
// server; a network failure and a typed HTTP error arriving as distinct
// ApiResult variants; recovery from a transient failure via the default
// retry policy; and onRequest injecting an auth header the server actually
// receives.
import { createServer } from 'node:http';
import { createApiClient } from '@firstprinciples/http-client';

interface User {
  id: string;
  name: string;
}

let flakyAttempts = 0;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const sendJson = (status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && /^\/users\/[^/]+$/.test(url.pathname)) {
    sendJson(200, { id: url.pathname.split('/').pop(), name: 'Ada Lovelace' });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/not-found') {
    sendJson(404, { message: 'No such user', code: 'USER_NOT_FOUND' });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/flaky') {
    flakyAttempts += 1;
    if (flakyAttempts < 2) {
      sendJson(503, { message: 'temporarily unavailable' });
      return;
    }
    sendJson(200, { attempts: flakyAttempts });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/whoami') {
    sendJson(200, { authorization: req.headers['authorization'] ?? null });
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
const baseUrl = `http://127.0.0.1:${String(address.port)}`;

console.log('--- 1. the endpoint-definition pattern ---\n');

const client = createApiClient({ baseUrl });
const getUser = client.endpoint<User>({ method: 'GET', path: '/users/:id' });
const userResult = await getUser({ id: '123' });

console.log(userResult.ok ? `Got user: ${userResult.value.name}` : 'Unexpected failure');

console.log('\n--- 2. a network failure and a typed HTTP error are distinct result kinds ---\n');

const unreachableClient = createApiClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2000 });
const networkResult = await unreachableClient.get('/x', { retry: false });
console.log(
  networkResult.ok
    ? 'unexpected success'
    : `kind: ${networkResult.kind}, status: ${String(networkResult.status)} — ${networkResult.error.message}`,
);

const httpErrorResult = await client.get('/not-found', { retry: false });
console.log(
  httpErrorResult.ok
    ? 'unexpected success'
    : `kind: ${httpErrorResult.kind}, status: ${String(httpErrorResult.status)} — ${httpErrorResult.error.code}`,
);

console.log('\n--- 3. a transient 503 recovers via the default retry policy ---\n');

const flakyResult = await client.get<{ attempts: number }>('/flaky');
console.log(
  flakyResult.ok
    ? `recovered after ${String(flakyResult.value.attempts)} attempt(s)`
    : 'did not recover',
);

console.log('\n--- 4. onRequest injects a header the server actually receives ---\n');

const authedClient = createApiClient({
  baseUrl,
  onRequest: (context) => {
    context.headers['authorization'] = 'Bearer demo-token-not-a-real-secret';
    return context;
  },
});
const whoamiResult = await authedClient.get<{ authorization: string | null }>('/whoami');
console.log(
  whoamiResult.ok ? `server saw: ${whoamiResult.value.authorization}` : 'unexpected failure',
);

server.close();
