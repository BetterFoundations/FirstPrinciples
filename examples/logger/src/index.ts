// Runnable usage example for \@firstprinciples/logger.
//
// Run with: pnpm --filter examples-logger start
//
// Three scenarios: a request-scoped correlation ID that survives real async
// work, automatic redaction of a secret buried in nested fields, and a
// custom transport standing in for "ship logs somewhere other than stdout".
import {
  createLogger,
  generateCorrelationId,
  runWithCorrelationId,
  type Transport,
} from '@firstprinciples/logger';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log('--- 1. correlation ID survives an await, a timer, and Promise.all ---\n');

const requestLogger = createLogger({ name: 'example-api' });

async function handleRequest(userId: string) {
  requestLogger.info('request received', { userId });
  await delay(5); // simulates an async DB call
  await Promise.all([delay(2), delay(3)]); // simulates two parallel downstream calls
  requestLogger.info('request handled', { userId }); // same correlation ID as above, with zero manual threading
}

await runWithCorrelationId(generateCorrelationId(), () => handleRequest('user_42'));

console.log('\n--- 2. a secret nested three levels deep gets redacted automatically ---\n');

const authLogger = createLogger({ name: 'example-auth' });

authLogger.info('login attempt', {
  request: {
    headers: {
      authorization: 'Bearer demo-token-not-a-real-secret',
    },
  },
  user: { email: 'someone@example.com' }, // caught by value shape, not just the key name
});

console.log('\n--- 3. a custom transport receives only the already-redacted entry ---\n');

const captured: unknown[] = [];
const captureTransport: Transport = {
  name: 'capture',
  write(entry) {
    captured.push(entry);
  },
};

const shippedLogger = createLogger({ name: 'example-shipper', transports: [captureTransport] });
shippedLogger.warn('low disk space', {
  volume: '/data',
  percentFree: 4,
  apiKey: 'this-is-gone-before-write-runs',
});

console.log('what the transport actually received (note apiKey):');
console.log(JSON.stringify(captured, null, 2));
