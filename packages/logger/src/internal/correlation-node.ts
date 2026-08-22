import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const storage = new AsyncLocalStorage<string>();

/** A fresh random correlation ID (a UUID v4). */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Runs `fn` with `id` as the active correlation ID for its entire async
 * extent — every `await`, `Promise.all` branch, `setTimeout`/`setInterval`
 * callback and `process.nextTick` scheduled during `fn` (directly or
 * transitively) sees `id` from {@link getCorrelationId}, courtesy of Node's
 * `AsyncLocalStorage`.
 */
export function runWithCorrelationId<T>(id: string, fn: () => T): T {
  return storage.run(id, fn);
}

/** The correlation ID active for the current async context, if any. */
export function getCorrelationId(): string | undefined {
  return storage.getStore();
}
