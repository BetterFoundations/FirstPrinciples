/**
 * @firstprinciples/bootstrap — a real service lifecycle, end to end:
 *
 *   1. An invalid environment is rejected with EVERY problem named at once.
 *   2. A valid one starts a fake database, then an HTTP server.
 *   3. Three slow requests are in flight when a real SIGTERM arrives.
 *   4. /readyz flips to failing, the requests all finish (with the database
 *      still open), then the database closes, then the process exits 0.
 */
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createHealthHandler,
  createService,
  envVar,
  EnvValidationError,
  httpServerResource,
  loadEnv,
  requireEnv,
  type DiagnosticsLogger,
} from '@firstprinciples/bootstrap';

// A compact logger so the output reads as a story. Any object with
// info/warn/error works; by default the package uses @firstprinciples/logger.
const logger: DiagnosticsLogger = {
  info: (msg, fields) => console.log(`  [info]  ${msg}`, fields ?? ''),
  warn: (msg, fields) => console.log(`  [warn]  ${msg}`, fields ?? ''),
  error: (msg, fields) => console.log(`  [error] ${msg}`, fields ?? ''),
};

const spec = {
  PORT: envVar.port().default(0),
  DATABASE_URL: envVar.url({ protocols: ['postgres'] }),
  REQUEST_DELAY_MS: envVar.number({ integer: true, min: 0 }).default(150),
  FEATURE_BETA: envVar.boolean().optional(),
};

console.log('\n1. A broken environment — every problem reported at once:');
const broken = loadEnv(spec, {
  PORT: 'eighty',
  DATABASE_URL: 'mysql://db/app',
  FEATURE_BETA: 'maybe',
});
if (!broken.ok) {
  for (const issue of broken.error.issues)
    console.log(`   - ${issue.variable} (${issue.problem}): ${issue.message}`);
  console.log(
    `   instanceof EnvValidationError: ${broken.error instanceof EnvValidationError}, code: ${broken.error.code}`,
  );
}

console.log('\n2. A valid environment (values are never logged, only names):');
const env = requireEnv(spec, { source: { DATABASE_URL: 'postgres://app:s3cret@db/app' }, logger });

let dbOpen = false;
let inFlight: Promise<string>[] = [];
const service = createService({
  name: 'example-api',
  logger,
  shutdownTimeoutMs: 5000,
  // The real process.exit — after showing what the in-flight clients got.
  exit: (code) => {
    void Promise.all(inFlight).then((replies) => {
      for (const reply of replies) console.log(`   in-flight request → ${reply}`);
      console.log(`\n5. exit(${code})\n`);
      process.exit(code);
    });
  },
});
const health = createHealthHandler(service);
const server = createServer((req, res) => {
  if (health(req, res)) return;
  setTimeout(
    () => res.end(dbOpen ? 'answered with the db still open' : 'db was already closed!'),
    env.REQUEST_DELAY_MS,
  );
});

service
  .addResource({
    name: 'db',
    start: () => {
      dbOpen = true;
    },
    stop: () => {
      dbOpen = false;
    },
  })
  .addCheck({ name: 'db', check: () => dbOpen })
  .addResource(httpServerResource(server, { port: env.PORT, host: '127.0.0.1' }));

await service.start();
const port = (server.address() as AddressInfo).port;

const get = (path: string) =>
  new Promise<string>((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, agent: false }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(`${res.statusCode} ${body}`));
    })
      .on('error', reject)
      .end();
  });

console.log(`\n3. Serving on :${port}. /readyz → ${await get('/readyz')}`);
inFlight = [get('/a'), get('/b'), get('/c')];
await new Promise((r) => setTimeout(r, 20));

console.log('\n4. SIGTERM with 3 requests in flight:');
process.kill(process.pid, 'SIGTERM');
await new Promise((r) => setTimeout(r, 5));
console.log(`   readiness while draining: ${JSON.stringify(await service.checkReadiness())}`);
