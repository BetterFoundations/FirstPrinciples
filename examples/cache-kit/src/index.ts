// Runnable usage example for @firstprinciples/cache-kit.
//
// Run with: pnpm --filter examples-cache-kit start
//
// Four scenarios, all against the in-memory backend (no Redis/Docker
// needed): cache-stampede protection under concurrent misses; tag-based
// invalidation; a simulated cache backend outage that `wrap` falls
// through cleanly instead of failing on; and a TTL actually expiring.
import { createCache, createMemoryBackend, CacheBackendError } from '@firstprinciples/cache-kit';
import type { CacheBackend } from '@firstprinciples/cache-kit';

console.log('--- 1. cache-stampede protection ---\n');

const cache = createCache(createMemoryBackend());
let upstreamCalls = 0;

async function fetchExpensiveReport(): Promise<string> {
  upstreamCalls += 1;
  await new Promise((resolve) => setTimeout(resolve, 50));
  return `report generated at call #${upstreamCalls}`;
}

const concurrentResults = await Promise.all(
  Array.from({ length: 10 }, () => cache.wrap('report', fetchExpensiveReport)),
);
console.log(`10 concurrent wrap() calls -> ${upstreamCalls} upstream call(s)`);
console.log(`every caller got: "${concurrentResults[0]}"`);
console.log(`all identical: ${concurrentResults.every((r) => r === concurrentResults[0])}`);

console.log('\n--- 2. tag-based invalidation ---\n');

await cache.set('user:1', { id: '1', name: 'Ada' }, { tags: ['users'] });
await cache.set('user:2', { id: '2', name: 'Grace' }, { tags: ['users'] });
await cache.set('config', { theme: 'dark' }); // untagged

console.log('before invalidateTag:');
console.log('  user:1', (await cache.get('user:1')).hit ? 'hit' : 'miss');
console.log('  user:2', (await cache.get('user:2')).hit ? 'hit' : 'miss');

await cache.invalidateTag('users');

console.log("after invalidateTag('users'):");
console.log('  user:1', (await cache.get('user:1')).hit ? 'hit' : 'miss');
console.log('  user:2', (await cache.get('user:2')).hit ? 'hit' : 'miss');
console.log('  config', (await cache.get('config')).hit ? 'hit' : 'miss', '(untagged, unaffected)');

console.log('\n--- 3. a cache backend outage never fails wrap() ---\n');

function createTotalOutageBackend(): CacheBackend {
  const outage = new CacheBackendError('simulated backend outage');
  return {
    get: () => Promise.reject(outage),
    set: () => Promise.reject(outage),
    delete: () => Promise.reject(outage),
    invalidateTag: () => Promise.reject(outage),
  };
}

const brokenCache = createCache(createTotalOutageBackend());
const value = await brokenCache.wrap('key', () => Promise.resolve('fetched despite the outage'));
console.log(`wrap() result during a total cache outage: "${value}"`);

console.log('\n--- 4. TTL expiry ---\n');

await cache.set('short-lived', 'v', { ttlMs: 100 });
console.log('immediately:', (await cache.get('short-lived')).hit ? 'hit' : 'miss');
await new Promise((resolve) => setTimeout(resolve, 150));
console.log('after 150ms (ttlMs was 100):', (await cache.get('short-lived')).hit ? 'hit' : 'miss');
